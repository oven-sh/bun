// Entry point for Valkey client
//
// This file contains the core Valkey client implementation with protocol handling

use core::mem::offset_of;

use bun_collections::OffsetByteList;
use bun_jsc::{JSGlobalObject, JSPromise, JSValue, JsResult, VirtualMachine};
use bun_uws::{self as uws, AnySocket, SocketGroup, SocketKind, SslCtx};
use bun_valkey::valkey_protocol as protocol;
use bun_valkey::valkey_protocol::{RESPValue, RedisError};

use super::js_valkey::JSValkeyClient;
use super::valkey_command::{self as command, Command};

pub use super::valkey_context as ValkeyContext;

// TODO(port): narrow error set — Zig `bun.JSTerminated!T` is `error{ Terminated }!T`.
// Using JsResult<T> (Thrown | OutOfMemory | Terminated) in Phase A.
type JsTerminated<T> = bun_jsc::JsResult<T>;

bun_output::declare_scope!(Redis, visible);
macro_rules! debug {
    ($($args:tt)*) => { bun_output::scoped_log!(Redis, $($args)*) };
}

/// Connection flags to track Valkey client state
pub struct ConnectionFlags {
    // TODO(markovejnovic): I am not a huge fan of these flags. I would
    // consider refactoring them into an enumerated state machine, as that
    // feels significantly more natural compared to a bag of booleans.
    pub is_authenticated: bool,
    pub is_manually_closed: bool,
    pub is_selecting_db_internal: bool,
    pub enable_offline_queue: bool,
    pub needs_to_open_socket: bool,
    pub enable_auto_reconnect: bool,
    pub is_reconnecting: bool,
    pub failed: bool,
    pub enable_auto_pipelining: bool,
    pub finalized: bool,
    // This flag is a slight hack to allow returning the client instance in the
    // promise which resolves when the connection is established. There are two
    // modes through which a client may connect:
    //   1. Connect through `client.connect()` which has the semantics of
    //      resolving the promise with the connection information.
    //   2. Through `client.duplicate()` which creates a promise through
    //      `onConnect()` which resolves with the client instance itself.
    // This flag is set to true in the latter case to indicate to the promise
    // resolution delegation to resolve the promise with the client.
    pub connection_promise_returns_client: bool,
}

impl Default for ConnectionFlags {
    fn default() -> Self {
        Self {
            is_authenticated: false,
            is_manually_closed: false,
            is_selecting_db_internal: false,
            enable_offline_queue: true,
            needs_to_open_socket: true,
            enable_auto_reconnect: true,
            is_reconnecting: false,
            failed: false,
            enable_auto_pipelining: true,
            finalized: false,
            connection_promise_returns_client: false,
        }
    }
}

/// Valkey connection status
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Status {
    Disconnected,
    Connecting,
    Connected,
}

pub fn is_active(this: &Status) -> bool {
    match *this {
        Status::Connected | Status::Connecting => true,
        _ => false,
    }
}

pub use super::valkey_command as Command_;
// PORT NOTE: Zig `pub const Command = @import("./ValkeyCommand.zig");` re-exports the module
// AND uses `Command` as the struct type (file-as-struct). In Rust the type lives at
// `super::valkey_command::Command`.

/// Valkey protocol types (standalone, TLS, Unix socket)
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Protocol {
    Standalone,
    StandaloneUnix,
    StandaloneTls,
    StandaloneTlsUnix,
}

impl Protocol {
    // PORT NOTE: `static` items are not allowed in `impl` blocks; phf maps are
    // const-constructible, so this is an associated const (still `Protocol::MAP`).
    pub const MAP: phf::Map<&'static [u8], Protocol> = phf::phf_map! {
        b"valkey" => Protocol::Standalone,
        b"valkeys" => Protocol::StandaloneTls,
        b"valkey+tls" => Protocol::StandaloneTls,
        b"valkey+unix" => Protocol::StandaloneUnix,
        b"valkey+tls+unix" => Protocol::StandaloneTlsUnix,
        b"redis" => Protocol::Standalone,
        b"rediss" => Protocol::StandaloneTls,
        b"redis+tls" => Protocol::StandaloneTls,
        b"redis+unix" => Protocol::StandaloneUnix,
        b"redis+tls+unix" => Protocol::StandaloneTlsUnix,
    };

    pub fn is_tls(self) -> bool {
        match self {
            Protocol::StandaloneTls | Protocol::StandaloneTlsUnix => true,
            _ => false,
        }
    }

    pub fn is_unix(self) -> bool {
        match self {
            Protocol::StandaloneUnix | Protocol::StandaloneTlsUnix => true,
            _ => false,
        }
    }
}

pub enum TLS {
    None,
    Enabled,
    Custom(bun_jsc::api::server_config::SSLConfig),
}

impl TLS {
    pub fn clone(&self) -> TLS {
        match self {
            TLS::Custom(ssl_config) => TLS::Custom(ssl_config.clone()),
            TLS::None => TLS::None,
            TLS::Enabled => TLS::Enabled,
        }
    }

    // PORT NOTE: Zig `deinit` only called `ssl_config.deinit()`. SSLConfig should impl Drop,
    // making this enum's Drop automatic. Kept for explicitness; Phase B may delete.
    // (No explicit Drop impl needed if SSLConfig: Drop.)

    pub fn reject_unauthorized(&self, vm: &VirtualMachine) -> bool {
        match self {
            TLS::Custom(ssl_config) => ssl_config.reject_unauthorized != 0,
            TLS::Enabled => vm.get_tls_reject_unauthorized(),
            _ => false,
        }
    }
}

impl Default for TLS {
    fn default() -> Self {
        TLS::None
    }
}

/// Connection options for Valkey client
pub struct Options {
    pub idle_timeout_ms: u32,
    pub connection_timeout_ms: u32,
    pub enable_auto_reconnect: bool,
    pub max_retries: u32,
    pub enable_offline_queue: bool,
    pub enable_auto_pipelining: bool,
    pub enable_debug_logging: bool,

    pub tls: TLS,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            idle_timeout_ms: 0,
            connection_timeout_ms: 10000,
            enable_auto_reconnect: true,
            max_retries: 20,
            enable_offline_queue: true,
            enable_auto_pipelining: true,
            enable_debug_logging: false,
            tls: TLS::None,
        }
    }
}

pub enum Address {
    // TODO(port): in Zig these slices borrow from `ValkeyClient.connection_strings`
    // (self-referential). Using owned Box<[u8]> in Phase A; Phase B may revisit.
    Unix(Box<[u8]>),
    Host { host: Box<[u8]>, port: u16 },
}

impl Address {
    pub fn hostname(&self) -> &[u8] {
        match self {
            Address::Unix(unix_addr) => unix_addr,
            Address::Host { host, .. } => host,
        }
    }

    pub fn connect(
        &self,
        client: &mut ValkeyClient,
        group: &mut SocketGroup,
        ssl_ctx: Option<&mut SslCtx>,
        is_tls: bool,
    ) -> Result<AnySocket, bun_core::Error> {
        // TODO(port): narrow error set
        // PORT NOTE: Zig used `switch (is_tls) { inline else => |tls| ... }` to comptime-dispatch
        // SocketTLS vs SocketTCP. Expanded to runtime if/else.
        // PERF(port): was comptime bool dispatch — profile in Phase B
        if is_tls {
            let kind = SocketKind::ValkeyTls;
            let sock = match self {
                Address::Unix(path) => {
                    uws::SocketTLS::connect_unix_group(group, kind, ssl_ctx, path, client, false)?
                }
                Address::Host { host, port } => {
                    uws::SocketTLS::connect_group(group, kind, ssl_ctx, host, *port, client, false)?
                }
            };
            Ok(AnySocket::SocketTLS(sock))
        } else {
            let kind = SocketKind::Valkey;
            let sock = match self {
                Address::Unix(path) => {
                    uws::SocketTCP::connect_unix_group(group, kind, ssl_ctx, path, client, false)?
                }
                Address::Host { host, port } => {
                    uws::SocketTCP::connect_group(group, kind, ssl_ctx, host, *port, client, false)?
                }
            };
            Ok(AnySocket::SocketTCP(sock))
        }
    }
}

/// Core Valkey client implementation
pub struct ValkeyClient {
    pub socket: AnySocket,
    pub status: Status,

    // Buffer management
    pub write_buffer: OffsetByteList,
    pub read_buffer: OffsetByteList,

    /// In-flight commands, after the data has been written to the network socket
    // TODO(port): `Queue` is `std.fifo.LinearFifo(PromisePair, .Dynamic)` in Zig — assume
    // valkey_command.rs exposes a matching type (readable_slice/read_item/write_item/etc.).
    pub in_flight: command::promise_pair::Queue,

    /// Commands that are waiting to be sent to the server. When pipelining is implemented, this usually will be empty.
    pub queue: command::entry::Queue,

    // Connection parameters
    // TODO(port): in Zig, password/username/address.hostname are views into `connection_strings`
    // (self-referential). Using owned Box<[u8]> in Phase A; `connection_strings` retained for
    // structural parity but may be redundant.
    pub password: Box<[u8]>,
    pub username: Box<[u8]>,
    pub database: u32,
    pub address: Address,
    pub protocol: Protocol,

    pub connection_strings: Box<[u8]>,

    // TLS support
    pub tls: TLS,

    // Timeout and reconnection management
    pub idle_timeout_interval_ms: u32,
    pub connection_timeout_ms: u32,
    pub retry_attempts: u32,
    pub max_retries: u32, // Maximum retry attempts

    pub flags: ConnectionFlags,
    // PORT NOTE: `allocator: std.mem.Allocator` deleted (non-AST crate; global mimalloc).

    // Auto-pipelining
    pub auto_flusher: AutoFlusher,

    pub vm: &'static VirtualMachine,
}

#[derive(Copy, Clone, Eq, PartialEq)]
enum SubscribeHandled {
    Handled,
    Fallthrough,
}

pub struct DeferredFailure {
    message: Box<[u8]>,
    err: RedisError,
    global_this: &'static JSGlobalObject,
    in_flight: command::promise_pair::Queue,
    queue: command::entry::Queue,
}

impl DeferredFailure {
    pub fn run(self: Box<Self>) -> JsTerminated<()> {
        // PORT NOTE: Zig `defer { free(message); destroy(this) }` — both handled by Box<Self> drop.
        debug!("running deferred failure");
        let mut this = *self;
        let err = protocol::valkey_error_to_js(this.global_this, &this.message, this.err);
        ValkeyClient::reject_all_pending_commands(
            &mut this.in_flight,
            &mut this.queue,
            this.global_this,
            err,
        )
    }

    pub fn enqueue(self: Box<Self>) {
        debug!("enqueueing deferred failure");
        // TODO(port): jsc.ManagedTask.New(DeferredFailure, run).init(this) — exact API TBD.
        let managed_task = bun_jsc::ManagedTask::new(self, DeferredFailure::run);
        VirtualMachine::get().event_loop().enqueue_task(managed_task);
    }
}

impl ValkeyClient {
    /// Clean up resources used by the Valkey client
    // TODO(port): cannot be `Drop` — takes a JSGlobalObject param and has JS side effects.
    // Renamed from Zig `deinit` per PORTING.md (never expose `pub fn deinit(&mut self)`).
    // Phase B: decide whether this becomes `finalize()` for the .classes.ts payload.
    pub fn shutdown(&mut self, global_object_or_finalizing: Option<&JSGlobalObject>) {
        let mut pending = core::mem::replace(
            &mut self.in_flight,
            command::promise_pair::Queue::default(),
        );
        let mut commands =
            core::mem::replace(&mut self.queue, command::entry::Queue::default());

        if let Some(global_this) = global_object_or_finalizing {
            let object = protocol::valkey_error_to_js(
                global_this,
                b"Connection closed",
                RedisError::ConnectionClosed,
            );
            for pair in pending.readable_slice(0) {
                let mut pair_ = *pair;
                let _ = pair_.reject_command(global_this, object); // TODO: properly propagate exception upwards
            }

            for cmd in commands.readable_slice(0) {
                let mut offline_cmd = *cmd;
                let _ = offline_cmd.promise.reject(global_this, object); // TODO: properly propagate exception upwards
                offline_cmd.deinit();
            }
        } else {
            // finalizing. we can't call into JS.
            for pair in pending.readable_slice(0) {
                let mut pair_ = *pair;
                pair_.promise.deinit();
            }

            for cmd in commands.readable_slice(0) {
                let mut offline_cmd = *cmd;
                offline_cmd.promise.deinit();
                offline_cmd.deinit();
            }
        }

        // PORT NOTE: `allocator.free(connection_strings)` and `write_buffer/read_buffer.deinit()`
        // and `tls.deinit()` are handled by Drop on the owning fields. Only the side-effecting
        // unregister remains explicit.
        // Note there is no need to deallocate username, password and hostname since they are
        // within the connection_strings buffer (in Zig; see TODO on field decls).
        drop(pending);
        drop(commands);
        self.unregister_auto_flusher();
    }

    // ** Auto-pipelining **
    fn register_auto_flusher(&mut self, vm: &VirtualMachine) {
        if !self.auto_flusher.registered {
            AutoFlusher::register_deferred_microtask_with_type_unchecked::<Self>(self, vm);
            self.auto_flusher.registered = true;
        }
    }

    fn unregister_auto_flusher(&mut self) {
        if self.auto_flusher.registered {
            AutoFlusher::unregister_deferred_microtask_with_type::<Self>(self, self.vm);
            self.auto_flusher.registered = false;
        }
    }

    // Drain auto-pipelined commands
    pub fn on_auto_flush(&mut self) -> bool {
        // Don't process if not connected or already processing
        if self.status != Status::Connected {
            self.auto_flusher.registered = false;
            return false;
        }

        self.ref_();
        let _guard = scopeguard::guard((), |_| self.deref());
        // TODO(port): errdefer/defer pattern — `ref/deref` reshaped with scopeguard; Phase B
        // verify borrowck allows capturing &mut self here. May need raw-ptr dance.

        // Start draining the command queue
        let mut have_more = false;
        let mut total_bytelength: usize = 0;

        // PORT NOTE: reshaped for borrowck — Zig held `to_process` slice while mutating
        // `in_flight`. We compute the count first, then operate.
        let pipelineable_count: usize = 'brk: {
            let to_process = self.queue.readable_slice(0);
            let mut total: usize = 0;
            for command in to_process {
                if !command.meta.supports_auto_pipelining {
                    break;
                }

                self.in_flight
                    .write_item(command::PromisePair {
                        meta: command.meta,
                        promise: command.promise,
                    })
                    .unwrap_or_oom();

                total += 1;
                total_bytelength += command.serialized_data.len();
            }
            break 'brk total;
        };

        self.write_buffer
            .byte_list
            .ensure_unused_capacity(total_bytelength)
            .unwrap_or_oom();
        {
            let pipelineable_commands = &self.queue.readable_slice(0)[0..pipelineable_count];
            for command in pipelineable_commands {
                self.write_buffer
                    .write(&command.serialized_data)
                    .unwrap_or_oom();
                // Free the serialized data since we've copied it to the write buffer
                // PORT NOTE: `allocator.free(command.serialized_data)` — handled when entry is
                // discarded below (Box<[u8]> drop).
            }
        }

        self.queue.discard(pipelineable_count);

        let _ = self.flush_data();

        have_more = self.queue.readable_length() > 0;
        self.auto_flusher.registered = have_more;

        // Return true if we should schedule another flush
        have_more
    }
    // ** End of auto-pipelining **

    /// Get the appropriate timeout interval based on connection state
    pub fn get_timeout_interval(&self) -> u32 {
        if self.flags.failed {
            return 0;
        }
        match self.status {
            Status::Connected => self.idle_timeout_interval_ms,
            _ => self.connection_timeout_ms,
        }
    }

    pub fn has_any_pending_commands(&self) -> bool {
        self.in_flight.readable_length() > 0
            || self.queue.readable_length() > 0
            || self.write_buffer.len() > 0
            || self.read_buffer.len() > 0
    }

    /// Calculate reconnect delay with exponential backoff
    pub fn get_reconnect_delay(&self) -> u32 {
        let base_delay: u32 = 50; // Base delay in ms
        let max_delay: u32 = 2000; // Max delay in ms

        // Fixed backoff calculation to avoid integer overflow
        if self.retry_attempts == 0 {
            return base_delay;
        }

        // Cap at 10 attempts for backoff calculation to avoid overflow
        let attempt = self.retry_attempts.min(10);

        // Use a safer exponential backoff calculation
        let mut delay: u32 = base_delay;
        let mut i: u32 = 1;
        while i < attempt {
            // Double the delay up to max_delay
            delay = (delay * 2).min(max_delay);
            i += 1;
        }

        delay
    }

    /// Reject all pending commands with an error
    fn reject_all_pending_commands(
        pending_ptr: &mut command::promise_pair::Queue,
        entries_ptr: &mut command::entry::Queue,
        global_this: &JSGlobalObject,
        jsvalue: JSValue,
    ) -> JsTerminated<()> {
        let pending = core::mem::replace(pending_ptr, command::promise_pair::Queue::default());
        let entries = core::mem::replace(entries_ptr, command::entry::Queue::default());
        // PORT NOTE: `defer pending.deinit()` / `defer entries.deinit()` — handled by Drop.

        // Reject commands in the command queue
        for item in pending.readable_slice(0) {
            let mut command_pair = *item;
            command_pair.reject_command(global_this, jsvalue)?;
        }

        // Reject commands in the offline queue
        for item in entries.readable_slice(0) {
            let mut cmd = *item;
            // PORT NOTE: `defer cmd.deinit(allocator)` — Entry should impl Drop.
            cmd.promise.reject(global_this, jsvalue)?;
        }
        Ok(())
    }

    /// Flush pending data to the socket
    pub fn flush_data(&mut self) -> bool {
        let chunk = self.write_buffer.remaining();
        if chunk.is_empty() {
            return false;
        }
        let wrote = self.socket.write(chunk);
        if wrote > 0 {
            self.write_buffer
                .consume(u32::try_from(wrote).unwrap());
        }
        let has_remaining = self.write_buffer.len() > 0;
        has_remaining
    }

    /// Mark the connection as failed with error message
    pub fn fail(&mut self, message: &[u8], err: RedisError) -> JsTerminated<()> {
        debug!("failed: {}: {:?}", bstr::BStr::new(message), err);
        if self.flags.failed {
            return Ok(());
        }

        if self.flags.finalized {
            // We can't run promises inside finalizers.
            if self.queue.count() + self.in_flight.count() > 0 {
                let vm = self.vm;
                let deferred_failure = Box::new(DeferredFailure {
                    // This memory is not owned by us.
                    message: Box::<[u8]>::from(message),

                    err,
                    global_this: vm.global,
                    in_flight: core::mem::replace(
                        &mut self.in_flight,
                        command::promise_pair::Queue::default(),
                    ),
                    queue: core::mem::replace(
                        &mut self.queue,
                        command::entry::Queue::default(),
                    ),
                });
                deferred_failure.enqueue();
            }

            // Allow the finalizer to call .close()
            return Ok(());
        }

        let global_this = self.global_object();
        self.fail_with_js_value(
            global_this,
            protocol::valkey_error_to_js(global_this, message, err),
        )
    }

    pub fn fail_with_js_value(
        &mut self,
        global_this: &JSGlobalObject,
        jsvalue: JSValue,
    ) -> JsTerminated<()> {
        if self.flags.failed {
            return Ok(());
        }
        self.flags.failed = true;
        let val =
            Self::reject_all_pending_commands(&mut self.in_flight, &mut self.queue, global_this, jsvalue);

        if !self.connection_ready() {
            self.flags.is_manually_closed = true;
            self.close();
        }
        val
    }

    pub fn close(&mut self) {
        let socket =
            core::mem::replace(&mut self.socket, AnySocket::SocketTCP(uws::SocketTCP::detached()));
        socket.close();
    }

    /// Handle connection closed event
    pub fn on_close(&mut self) -> JsTerminated<()> {
        self.unregister_auto_flusher();
        self.write_buffer.clear_and_free();

        // If manually closing, don't attempt to reconnect
        if self.flags.is_manually_closed {
            debug!("skip reconnecting since the connection is manually closed");
            self.fail(b"Connection closed", RedisError::ConnectionClosed)?;
            self.on_valkey_close()?;
            return Ok(());
        }

        // If auto reconnect is disabled, just fail
        if !self.flags.enable_auto_reconnect {
            debug!("skip reconnecting since auto reconnect is disabled");
            self.fail(b"Connection closed", RedisError::ConnectionClosed)?;
            self.on_valkey_close()?;
            return Ok(());
        }

        // Calculate reconnection delay with exponential backoff
        self.retry_attempts += 1;
        let delay_ms = self.get_reconnect_delay();

        if delay_ms == 0 || self.retry_attempts > self.max_retries {
            debug!("Max retries reached or retry strategy returned 0, giving up reconnection");
            self.fail(b"Max reconnection attempts reached", RedisError::ConnectionClosed)?;
            self.on_valkey_close()?;
            return Ok(());
        }

        debug!(
            "reconnect in {}ms (attempt {}/{})",
            delay_ms, self.retry_attempts, self.max_retries
        );

        self.flags.is_reconnecting = true;
        self.flags.is_authenticated = false;
        self.flags.is_selecting_db_internal = false;

        // Signal reconnect timer should be started
        self.on_valkey_reconnect();
        Ok(())
    }

    pub fn send_next_command(&mut self) {
        if self.write_buffer.remaining().is_empty() && self.connection_ready() {
            if self.queue.readable_length() > 0 {
                // Check the command at the head of the queue
                let flags = self.queue.peek_item(0).meta;

                if !flags.supports_auto_pipelining {
                    // Head is non-pipelineable. Try to drain it serially if nothing is in-flight.
                    if self.in_flight.readable_length() == 0 {
                        let _ = self.drain(); // Send the single non-pipelineable command

                        // After draining, check if the *new* head is pipelineable and schedule flush if needed.
                        // This covers sequences like NON_PIPE -> PIPE -> PIPE ...
                        if self.queue.readable_length() > 0
                            && self.queue.peek_item(0).meta.supports_auto_pipelining
                        {
                            self.register_auto_flusher(self.vm);
                        }
                    } else {
                        // Non-pipelineable command is blocked by in-flight commands. Do nothing, wait for in-flight to finish.
                    }
                } else {
                    // Head is pipelineable. Register the flusher to batch it with others.
                    self.register_auto_flusher(self.vm);
                }
            } else if self.in_flight.readable_length() == 0 {
                // Without auto pipelining, wait for in-flight to empty before draining
                let _ = self.drain();
            }
        }

        let _ = self.flush_data();
    }

    /// Process data received from socket
    ///
    /// Caller refs / derefs.
    pub fn on_data(&mut self, data: &[u8]) -> JsTerminated<()> {
        debug!(
            "Low-level onData called with {} bytes: {}",
            data.len(),
            bstr::BStr::new(data)
        );
        // Path 1: Buffer already has data, append and process from buffer
        if !self.read_buffer.remaining().is_empty() {
            self.read_buffer
                .write(data)
                .expect("failed to write to read buffer");

            // Process as many complete messages from the buffer as possible
            loop {
                let remaining_buffer = self.read_buffer.remaining();
                if remaining_buffer.is_empty() {
                    break; // Buffer processed completely
                }

                let mut reader = protocol::ValkeyReader::init(remaining_buffer);
                let before_read_pos = reader.pos;

                let mut value = match reader.read_value() {
                    Ok(v) => v,
                    Err(err) => {
                        if err == RedisError::InvalidResponse {
                            // Need more data in the buffer, wait for next onData call
                            if cfg!(debug_assertions) {
                                debug!(
                                    "read_buffer: needs more data ({} bytes available)",
                                    remaining_buffer.len()
                                );
                            }
                            return Ok(());
                        } else {
                            self.fail(b"Failed to read data (buffer path)", err)?;
                            return Ok(());
                        }
                    }
                };
                // PORT NOTE: `defer value.deinit(allocator)` — RESPValue should impl Drop.

                let bytes_consumed = reader.pos - before_read_pos;
                if bytes_consumed == 0 && !remaining_buffer.is_empty() {
                    self.fail(
                        b"Parser consumed 0 bytes unexpectedly (buffer path)",
                        RedisError::InvalidResponse,
                    )?;
                    return Ok(());
                }

                self.read_buffer.consume(bytes_consumed as u32);

                let mut value_to_handle = value; // Use temp var for defer
                if let Err(err) = self.handle_response(&mut value_to_handle) {
                    // TODO(port): narrow error set — Zig caller passes err to fail() which takes RedisError
                    self.fail(b"Failed to handle response (buffer path)", err)?;
                    return Ok(());
                }

                if self.status == Status::Disconnected || self.flags.failed {
                    return Ok(());
                }
                self.send_next_command();
            }
            return Ok(()); // Finished processing buffered data for now
        }

        // Path 2: Buffer is empty, try processing directly from stack 'data'
        let mut current_data_slice = data; // Create a mutable view of the incoming data
        while !current_data_slice.is_empty() {
            let mut reader = protocol::ValkeyReader::init(current_data_slice);
            let before_read_pos = reader.pos;

            let mut value = match reader.read_value() {
                Ok(v) => v,
                Err(err) => {
                    if err == RedisError::InvalidResponse {
                        // Partial message encountered on the stack-allocated path.
                        // Copy the *remaining* part of the stack data to the heap buffer
                        // and wait for more data.
                        if cfg!(debug_assertions) {
                            debug!(
                                "read_buffer: partial message on stack ({} bytes), switching to buffer",
                                current_data_slice.len() - before_read_pos
                            );
                        }
                        self.read_buffer
                            .write(&current_data_slice[before_read_pos..])
                            .expect("failed to write remaining stack data to buffer");
                        return Ok(()); // Exit onData, next call will use the buffer path
                    } else {
                        // Any other error is fatal
                        self.fail(b"Failed to read data (stack path)", err)?;
                        return Ok(());
                    }
                }
            };
            // Successfully read a full message from the stack data
            // PORT NOTE: `defer value.deinit(allocator)` — RESPValue should impl Drop.

            let bytes_consumed = reader.pos - before_read_pos;
            if bytes_consumed == 0 {
                // This case should ideally not happen if readValue succeeded and slice wasn't empty
                self.fail(
                    b"Parser consumed 0 bytes unexpectedly (stack path)",
                    RedisError::InvalidResponse,
                )?;
                return Ok(());
            }

            // Advance the view into the stack data slice for the next iteration
            current_data_slice = &current_data_slice[bytes_consumed..];

            // Handle the successfully parsed response
            let mut value_to_handle = value; // Use temp var for defer
            if let Err(err) = self.handle_response(&mut value_to_handle) {
                // TODO(port): narrow error set — Zig caller passes err to fail() which takes RedisError
                self.fail(b"Failed to handle response (stack path)", err)?;
                return Ok(());
            }

            // Check connection status after handling
            if self.status == Status::Disconnected || self.flags.failed {
                return Ok(());
            }

            // After handling a response, try to send the next command
            self.send_next_command();

            // Loop continues with the remainder of current_data_slice
        }

        // If the loop finishes, the entire 'data' was processed without needing the buffer.
        Ok(())
    }

    /// Try handling this response as a subscriber-state response.
    /// Returns `handled` if we handled it, `fallthrough` if we did not.
    fn handle_subscribe_response(
        &mut self,
        value: &mut RESPValue,
        pair: Option<&mut command::PromisePair>,
    ) -> JsResult<SubscribeHandled> {
        // Resolve the promise with the potentially transformed value
        let global_this = self.global_object();
        let loop_ = self.vm.event_loop();

        debug!("Handling a subscribe response: {}", value);
        loop_.enter();
        let _exit = scopeguard::guard((), |_| loop_.exit());

        match value {
            RESPValue::Error(_) => {
                if let Some(p) = pair {
                    p.promise.reject(global_this, value.to_js(global_this))?;
                }
                Ok(SubscribeHandled::Handled)
            }
            RESPValue::Push(push) => {
                let p = self.parent();
                let sub_count = p._subscription_ctx.channels_subscribed_to_count(global_this)?;

                if let Some(msg_type) = protocol::SubscriptionPushMessage::MAP.get(&push.kind) {
                    match msg_type {
                        protocol::SubscriptionPushMessage::Message => {
                            self.on_valkey_message(&mut push.data);
                            Ok(SubscribeHandled::Handled)
                        }
                        protocol::SubscriptionPushMessage::Subscribe => {
                            p.add_subscription();
                            self.on_valkey_subscribe(value);

                            // For SUBSCRIBE responses, only resolve the promise for the first channel confirmation
                            // Additional channel confirmations from multi-channel SUBSCRIBE commands don't need promise pairs
                            if let Some(req_pair) = pair {
                                req_pair
                                    .promise
                                    .promise
                                    .resolve(global_this, JSValue::js_number(sub_count))?;
                            }
                            Ok(SubscribeHandled::Handled)
                        }
                        protocol::SubscriptionPushMessage::Unsubscribe => {
                            self.on_valkey_unsubscribe()?;
                            p.remove_subscription();

                            // For UNSUBSCRIBE responses, only resolve the promise if we have one
                            // Additional channel confirmations from multi-channel UNSUBSCRIBE commands don't need promise pairs
                            if let Some(req_pair) = pair {
                                req_pair
                                    .promise
                                    .promise
                                    .resolve(global_this, JSValue::UNDEFINED)?;
                            }
                            Ok(SubscribeHandled::Handled)
                        }
                    }
                } else {
                    // We should rarely reach this point. If we're guaranteed to be handling a subscribe/unsubscribe,
                    // then this is an unexpected path.
                    #[cold]
                    fn cold() {}
                    cold();
                    self.fail(
                        b"Push message is not a subscription message.",
                        RedisError::InvalidResponseType,
                    )?;
                    Ok(SubscribeHandled::Handled)
                }
            }
            _ => {
                // This may be a regular command response. Let's pass it down
                // to the next handler.
                Ok(SubscribeHandled::Fallthrough)
            }
        }
    }

    fn handle_hello_response(&mut self, value: &mut RESPValue) -> JsTerminated<()> {
        debug!("Processing HELLO response");

        match value {
            RESPValue::Error(err) => {
                self.fail(err, RedisError::AuthenticationFailed)?;
                Ok(())
            }
            RESPValue::SimpleString(str_) => {
                if str_.as_ref() == b"OK" {
                    self.status = Status::Connected;
                    self.flags.is_authenticated = true;
                    self.flags.is_reconnecting = false;
                    self.retry_attempts = 0;
                    self.on_valkey_connect(value)?;
                    return Ok(());
                }
                self.fail(
                    b"Authentication failed (unexpected response)",
                    RedisError::AuthenticationFailed,
                )?;

                Ok(())
            }
            RESPValue::Map(map) => {
                // This is the HELLO response map
                debug!("Got HELLO response map with {} entries", map.len());

                // Process the Map response - find the protocol version
                for entry in map.iter() {
                    match &entry.key {
                        RESPValue::SimpleString(key) => {
                            if key.as_ref() == b"proto" {
                                if let RESPValue::Integer(proto_version) = entry.value {
                                    debug!("Server protocol version: {}", proto_version);
                                    if proto_version != 3 {
                                        self.fail(
                                            b"Server does not support RESP3",
                                            RedisError::UnsupportedProtocol,
                                        )?;
                                        return Ok(());
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }

                // Authentication successful via HELLO
                self.status = Status::Connected;
                self.flags.is_authenticated = true;
                self.flags.is_reconnecting = false;
                self.retry_attempts = 0;
                self.on_valkey_connect(value)?;
                Ok(())
            }
            _ => {
                self.fail(
                    b"Authentication failed with unexpected response",
                    RedisError::AuthenticationFailed,
                )?;
                Ok(())
            }
        }
    }

    /// Handle Valkey protocol response
    fn handle_response(&mut self, value: &mut RESPValue) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set — Zig return type was `!void` (inferred); body mixes
        // JsError/JSTerminated (from `fail`/`handle_subscribe_response`) and RedisError. Widened
        // to bun_core::Error in Phase A; relies on From<JsError>/From<RedisError> for bun_core::Error.
        // Special handling for the initial HELLO response
        if !self.flags.is_authenticated {
            self.handle_hello_response(value)?;

            // We've handled the HELLO response without consuming anything from the command queue
            return Ok(());
        }

        // Handle initial SELECT response
        if self.flags.is_selecting_db_internal {
            self.flags.is_selecting_db_internal = false;

            return match value {
                RESPValue::Error(err_str) => {
                    self.fail(err_str, RedisError::InvalidCommand)?;
                    Ok(())
                }
                RESPValue::SimpleString(ok_str) => {
                    if ok_str.as_ref() != b"OK" {
                        // SELECT returned something other than "OK"
                        self.fail(
                            b"SELECT command failed with non-OK response",
                            RedisError::InvalidResponse,
                        )?;
                        return Ok(());
                    }

                    // SELECT was successful.
                    debug!("SELECT {} successful", self.database);
                    // Connection is now fully ready on the specified database.
                    // If any commands were queued while waiting for SELECT, try to send them.
                    self.send_next_command();
                    Ok(())
                }
                _ => {
                    // Unexpected response type for SELECT
                    self.fail(
                        b"Received non-SELECT response while in the SELECT state.",
                        RedisError::InvalidResponse,
                    )?;
                    Ok(())
                }
            };
        }
        // Check if this is a subscription push message that might not need a promise pair
        let mut should_consume_promise_pair = true;
        let mut pair_maybe: Option<command::PromisePair> = None;

        // For subscription clients, check if this is a push message that doesn't need a promise pair
        if self.parent().is_subscriber() {
            if let RESPValue::Push(push) = value {
                if let Some(msg_type) = protocol::SubscriptionPushMessage::MAP.get(&push.kind) {
                    match msg_type {
                        protocol::SubscriptionPushMessage::Message => {
                            // Message pushes never need promise pairs
                            should_consume_promise_pair = false;
                        }
                        protocol::SubscriptionPushMessage::Subscribe
                        | protocol::SubscriptionPushMessage::Unsubscribe => {
                            // Subscribe/unsubscribe pushes only need promise pairs if we have pending commands
                            if self.in_flight.readable_length() == 0 {
                                should_consume_promise_pair = false;
                            }
                        }
                    }
                }
            }
        }

        // Only consume promise pair if we determined we need one
        // The reaosn we consume pairs is that a SUBSCRIBE message may actually be followed by a number of SUBSCRIBE
        // responses which indicate all the channels we have connected to. As a stop-gap, we currently ignore the
        // actual of content of the SUBSCRIBE responses and just resolve the first one with the count of channels.
        // TODO(markovejnovic): Do better.
        if should_consume_promise_pair {
            pair_maybe = self.in_flight.read_item();
        }

        // We handle subscriptions specially because they are not regular commands and their failure will potentially
        // cause the client to drop out of subscriber mode.
        let request_is_subscribe = pair_maybe
            .as_ref()
            .map(|p| p.meta.subscription_request)
            .unwrap_or(false);
        if self.parent().is_subscriber() || request_is_subscribe {
            debug!("This client is a subscriber. Handling as subscriber...");

            match value {
                RESPValue::Error(err) => {
                    self.fail(err, RedisError::InvalidResponse)?;
                    return Ok(());
                }
                RESPValue::Push(push) => {
                    if protocol::SubscriptionPushMessage::MAP.get(&push.kind).is_some() {
                        if self.handle_subscribe_response(value, pair_maybe.as_mut())?
                            == SubscribeHandled::Handled
                        {
                            return Ok(());
                        }
                    } else {
                        #[cold]
                        fn cold() {}
                        cold();
                        self.fail(
                            b"Unexpected push message kind without promise",
                            RedisError::InvalidResponseType,
                        )?;
                        return Ok(());
                    }
                }
                _ => {
                    // In the else case, we fall through to the regular
                    // handler. Subscribers can send .Push commands which have
                    // the same semantics as regular commands.
                }
            }

            debug!("Treating subscriber response as a regular command...");
        }

        // For regular commands, get the next command+promise pair from the queue
        let Some(mut pair) = pair_maybe else {
            return Ok(());
        };

        let meta = pair.meta;

        // Handle the response based on command type
        if meta.return_as_bool {
            // EXISTS returns 1 if key exists, 0 if not - we convert to boolean
            if let RESPValue::Integer(int_value) = *value {
                *value = RESPValue::Boolean(int_value > 0);
            }
        }

        // Resolve the promise with the potentially transformed value
        let promise_ptr = &mut pair.promise;
        let global_this = self.global_object();
        let loop_ = self.vm.event_loop();

        loop_.enter();
        let _exit = scopeguard::guard((), |_| loop_.exit());

        if matches!(value, RESPValue::Error(_)) {
            let js_err = match value.to_js(global_this) {
                Ok(v) => v,
                Err(err) => global_this.take_error(err),
            };
            promise_ptr.reject(global_this, js_err)?;
        } else {
            promise_ptr.resolve(global_this, value)?;
        }
        Ok(())
    }

    /// Send authentication command to Valkey server
    fn authenticate(&mut self) -> JsTerminated<()> {
        // First send HELLO command for RESP3 protocol
        debug!("Sending HELLO 3 command");

        let mut hello_args_buf: [&[u8]; 4] = [b"3", b"AUTH", b"", b""];
        let hello_args: &[&[u8]];

        if !self.username.is_empty() || !self.password.is_empty() {
            hello_args_buf[0] = b"3";
            hello_args_buf[1] = b"AUTH";

            if !self.username.is_empty() {
                hello_args_buf[2] = &self.username;
                hello_args_buf[3] = &self.password;
            } else {
                hello_args_buf[2] = b"default";
                hello_args_buf[3] = &self.password;
            }

            hello_args = &hello_args_buf[0..4];
        } else {
            hello_args = &hello_args_buf[0..1];
        }

        // Format and send the HELLO command without adding to command queue
        // We'll handle this response specially in handleResponse
        let mut hello_cmd = Command {
            command: b"HELLO",
            args: command::Args::Raw(hello_args),
            ..Default::default()
        };

        if let Err(err) = hello_cmd.write(self.writer()) {
            self.fail(b"Failed to write HELLO command", err)?;
            return Ok(());
        }

        // If using a specific database, send SELECT command
        if self.database > 0 {
            let mut int_buf = [0u8; 64];
            // TODO(port): std.fmt.bufPrintZ — using itoa-style write into stack buf.
            let db_str = {
                use std::io::Write;
                let mut cursor = &mut int_buf[..];
                write!(cursor, "{}", self.database).expect("unreachable");
                let written = 64 - cursor.len();
                &int_buf[..written]
            };
            let mut select_cmd = Command {
                command: b"SELECT",
                args: command::Args::Raw(&[db_str]),
                ..Default::default()
            };
            if let Err(err) = select_cmd.write(self.writer()) {
                self.fail(b"Failed to write SELECT command", err)?;
                return Ok(());
            }
            self.flags.is_selecting_db_internal = true;
        }
        Ok(())
    }

    /// Handle socket open event
    pub fn on_open(&mut self, socket: AnySocket) -> JsTerminated<()> {
        self.socket = socket;
        self.write_buffer.clear_and_free();
        self.read_buffer.clear_and_free();
        // A fresh socket has opened, so reset per-connection state. Without
        // this, `send()` would permanently reject with "Connection has failed"
        // after a previous connection exhausted retries (#29925), and the
        // new HELLO response would be dropped because `is_authenticated` was
        // still set from a prior successful handshake — blocking the client
        // from ever transitioning back to `.connected`.
        self.flags.failed = false;
        self.flags.is_authenticated = false;
        self.flags.is_selecting_db_internal = false;
        if matches!(self.socket, AnySocket::SocketTCP(_)) {
            // if is tcp, we need to start the connection process
            // if is tls, we need to wait for the handshake to complete
            self.start()?;
        }
        Ok(())
    }

    /// Start the connection process
    pub fn start(&mut self) -> JsTerminated<()> {
        self.authenticate()?;
        let _ = self.flush_data();
        Ok(())
    }

    /// Test whether we are ready to run "normal" RESP commands, such as
    /// get/set, pub/sub, etc.
    fn connection_ready(&self) -> bool {
        self.flags.is_authenticated && !self.flags.is_selecting_db_internal
    }

    /// Process queued commands in the offline queue
    pub fn drain(&mut self) -> bool {
        // If there's something in the in-flight queue and the next command
        // doesn't support pipelining, we should wait for in-flight commands to complete
        if self.in_flight.readable_length() > 0 {
            let queue_slice = self.queue.readable_slice(0);
            if !queue_slice.is_empty() && !queue_slice[0].meta.supports_auto_pipelining {
                return false;
            }
        }

        let Some(offline_cmd) = self.queue.read_item() else {
            return false;
        };

        // Add the promise to the command queue first
        self.in_flight
            .write_item(command::PromisePair {
                meta: offline_cmd.meta,
                promise: offline_cmd.promise,
            })
            .unwrap_or_oom();
        let data = offline_cmd.serialized_data;

        if self.connection_ready() && self.write_buffer.remaining().is_empty() {
            // Optimization: avoid cloning the data an extra time.
            // PORT NOTE: `defer allocator.free(data)` — `data: Box<[u8]>` drops at scope end.

            let wrote = self.socket.write(&data);
            let unwritten = &data[usize::try_from(wrote.max(0)).unwrap()..];

            if !unwritten.is_empty() {
                // Handle incomplete write.
                self.write_buffer.write(unwritten).unwrap_or_oom();
            }

            return true;
        }

        // Write the pre-serialized data directly to the output buffer
        let _ = self.write(&data).unwrap_or_oom();
        // PORT NOTE: `bun.default_allocator.free(data)` — Box<[u8]> drops here.

        true
    }

    pub fn on_writable(&mut self) {
        self.ref_();
        let _guard = scopeguard::guard((), |_| self.deref());
        // TODO(port): borrowck — capturing &mut self in guard while calling &mut self method below.

        self.send_next_command();
    }

    fn enqueue(
        &mut self,
        command: &Command,
        promise: &mut command::Promise,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let can_pipeline =
            command.meta.supports_auto_pipelining && self.flags.enable_auto_pipelining;

        // For commands that don't support pipelining, we need to wait for the queue to drain completely
        // before sending the command. This ensures proper order of execution for state-changing commands.
        let must_wait_for_queue =
            !command.meta.supports_auto_pipelining && self.queue.readable_length() > 0;

        if
        // If there are any pending commands, queue this one
        self.queue.readable_length() > 0
            // With auto pipelining, we can accept commands regardless of in_flight commands
            || (!can_pipeline && self.in_flight.readable_length() > 0)
            // We need authentication before processing commands
            || !self.connection_ready()
            // Commands that don't support pipelining must wait for the entire queue to drain
            || must_wait_for_queue
            // If can pipeline, we can accept commands regardless of in_flight commands
            || can_pipeline
        {
            // We serialize the bytes in here, so we don't need to worry about the lifetime of the Command itself.
            let entry = command::Entry::create(command, *promise)?;
            self.queue.write_item(entry)?;

            // If we're connected and using auto pipelining, schedule a flush
            if self.status == Status::Connected && can_pipeline {
                self.register_auto_flusher(self.vm);
            }

            return Ok(());
        }

        match self.status {
            Status::Connecting | Status::Connected => {
                if command.write(self.writer()).is_err() {
                    promise.reject(
                        self.global_object(),
                        self.global_object().create_out_of_memory_error(),
                    )?;
                    return Ok(());
                }
            }
            _ => unreachable!(),
        }

        let cmd_pair = command::PromisePair {
            meta: command.meta,
            promise: *promise,
        };

        // Add to queue with command type
        self.in_flight.write_item(cmd_pair)?;

        let _ = self.flush_data();
        Ok(())
    }

    pub fn send(
        &mut self,
        global_this: &JSGlobalObject,
        command: &Command,
    ) -> Result<*mut JSPromise, bun_core::Error> {
        // TODO(port): narrow error set
        // FIX: Check meta before using it for routing decisions
        let mut checked_command = *command;
        checked_command.meta = command.meta.check(command);

        let mut promise = command::Promise::create(global_this, checked_command.meta);

        let js_promise = promise.promise.get();
        if self.flags.failed {
            promise.reject(
                global_this,
                global_this
                    .err(bun_jsc::ErrorCode::REDIS_CONNECTION_CLOSED, "Connection has failed")
                    .to_js(),
            )?;
        } else {
            // Handle disconnected state with offline queue
            match self.status {
                Status::Connected => {
                    self.enqueue(&checked_command, &mut promise)?;

                    // Schedule auto-flushing to process this command if pipelining is enabled
                    if self.flags.enable_auto_pipelining
                        && checked_command.meta.supports_auto_pipelining
                        && self.status == Status::Connected
                        && self.queue.readable_length() > 0
                    {
                        self.register_auto_flusher(self.vm);
                    }
                }
                Status::Connecting | Status::Disconnected => {
                    // Only queue if offline queue is enabled
                    if self.flags.enable_offline_queue {
                        self.enqueue(&checked_command, &mut promise)?;
                    } else {
                        promise.reject(
                            global_this,
                            global_this
                                .err(
                                    bun_jsc::ErrorCode::REDIS_CONNECTION_CLOSED,
                                    "Connection is closed and offline queue is disabled",
                                )
                                .to_js(),
                        )?;
                    }
                }
            }
        }

        Ok(js_promise)
    }

    /// Close the Valkey connection
    pub fn disconnect(&mut self) {
        self.flags.is_manually_closed = true;
        self.unregister_auto_flusher();
        if self.status == Status::Connected || self.status == Status::Connecting {
            self.close();
        }
    }

    /// Get a writer for the connected socket
    // TODO(port): Zig returned `std.Io.GenericWriter(*ValkeyClient, RedisError, write)`.
    // In Rust, ValkeyClient itself can serve as the writer (see `write` below). Phase B:
    // decide whether to impl `bun_io::Write` directly or return a thin wrapper.
    pub fn writer(&mut self) -> &mut Self {
        self
    }

    /// Write data to the socket buffer
    fn write(&mut self, data: &[u8]) -> Result<usize, RedisError> {
        self.write_buffer.write(data)?;
        Ok(data.len())
    }

    /// Increment reference count
    pub fn ref_(&mut self) {
        self.parent().ref_();
    }

    pub fn deref(&mut self) {
        self.parent().deref();
    }

    #[inline]
    fn parent(&mut self) -> &mut JSValkeyClient {
        // SAFETY: self points to JSValkeyClient.client (intrusive embed via @fieldParentPtr).
        unsafe {
            &mut *((self as *mut Self as *mut u8)
                .sub(offset_of!(JSValkeyClient, client))
                .cast::<JSValkeyClient>())
        }
    }

    #[inline]
    fn global_object(&mut self) -> &JSGlobalObject {
        self.parent().global_object
    }

    pub fn on_valkey_connect(&mut self, value: &mut RESPValue) -> JsTerminated<()> {
        self.parent().on_valkey_connect(value)
    }

    pub fn on_valkey_subscribe(&mut self, value: &mut RESPValue) {
        self.parent().on_valkey_subscribe(value);
    }

    pub fn on_valkey_unsubscribe(&mut self) -> JsResult<()> {
        self.parent().on_valkey_unsubscribe()
    }

    pub fn on_valkey_message(&mut self, value: &mut [RESPValue]) {
        self.parent().on_valkey_message(value);
    }

    pub fn on_valkey_reconnect(&mut self) {
        self.parent().on_valkey_reconnect();
    }

    pub fn on_valkey_close(&mut self) -> JsTerminated<()> {
        self.parent().on_valkey_close()
    }

    pub fn on_valkey_timeout(&mut self) {
        self.parent().on_valkey_timeout();
    }
}

// Auto-pipelining
// TODO(port): jsc.WebCore.AutoFlusher — confirm crate path.
use bun_jsc::webcore::AutoFlusher;

// TODO(port): trait providing `.unwrap_or_oom()` on Result<T, AllocError> — assumed in bun_alloc.
use bun_alloc::UnwrapOrOom;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/valkey_jsc/valkey.zig (1228 lines)
//   confidence: medium
//   todos:      18
//   notes:      self-referential connection_strings borrows → Box<[u8]>; Queue type assumed from valkey_command; handle_response widened to bun_core::Error (callers pass it to fail() which wants RedisError — Phase B narrows); ref/deref scopeguards may fight borrowck
// ──────────────────────────────────────────────────────────────────────────
