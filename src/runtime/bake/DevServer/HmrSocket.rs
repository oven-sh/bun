use bun_collections::HashMap;
use bun_core::strings;
use bun_core::{Output, feature_flags};
use bun_uws::AnyWebSocket;
use bun_uws_sys::{Opcode, SendStatus};

use crate::timer::EventLoopTimerState;

use super::source_map_store::{self, RemoveOrUpgradeMode};
use super::{ConsoleLogKind, DevServer, HmrTopic, IncomingMessageId, MessageId, RouteBundle};
use crate::bake::dev_server_body::HmrTopicBits;

// Local shim for Zig's `res: anytype` — shared with `DevServer::on_web_socket_upgrade`.
// TODO(port): replace with `bun_uws::ResponseLike` once that trait lands upstream.
pub use super::ResponseLike;

// Struct definition lives in `dev_server/mod.rs` so the public
// `crate::bake::dev_server::HmrSocket` path and these impl blocks name a
// single type (no cross-type pointer casts).
pub use super::HmrSocket;

impl HmrSocket {
    // `res: anytype` — only `.getRemoteSocketInfo()` is called on it.
    // Bound matches the caller in `DevServer::on_web_socket_upgrade`.
    pub fn new<R>(dev: &mut DevServer, res: &mut R) -> Box<HmrSocket>
    where
        R: ResponseLike,
    {
        let is_from_localhost = if let Some(addr) = res.get_remote_socket_info() {
            if addr.is_ipv6 {
                &addr.ip[..] == b"::1"
            } else {
                &addr.ip[..] == b"127.0.0.1"
            }
        } else {
            false
        };
        Box::new(HmrSocket {
            dev: bun_ptr::BackRef::new_mut(dev),
            is_from_localhost,
            subscriptions: HmrTopicBits::empty(),
            active_route: None,
            referenced_source_maps: HashMap::default(),
            underlying: None,
            inspector_connection_id: -1,
        })
    }

    /// SAFETY: caller must guarantee no other live `&mut DevServer` aliases the
    /// returned borrow for its lifetime (BackRef::get_mut exclusivity rule).
    /// Liveness is structural: HmrSocket lifetime is strictly nested inside
    /// DevServer (the socket is removed from `active_websocket_connections` and
    /// destroyed before DevServer is torn down) — the BackRef invariant.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    unsafe fn dev<'a>(&self) -> &'a mut DevServer {
        // Detach the borrow from `&self` (explicit unbound `'a`) so callers may
        // interleave `self.*` field access with `dev.*` — DevServer is a
        // separate heap allocation.
        // SAFETY: caller upholds exclusivity; BackRef invariant guarantees liveness.
        unsafe { &mut *self.dev.as_ptr() }
    }

    pub fn on_open(&mut self, ws: AnyWebSocket) {
        // SAFETY: JS-thread only; sole `&mut DevServer` for this scope. Derived
        // via the BackRef accessor (lifetime-detached from `&self`) so we can
        // assign `self.underlying` below while `dev` is still live.
        let dev = unsafe { self.dev() };
        let mut header = [0u8; 1 + DevServer::CONFIGURATION_HASH_KEY_LEN];
        header[0] = MessageId::Version.char();
        header[1..].copy_from_slice(&dev.configuration_hash_key);
        let send_status = ws.send(&header, Opcode::Binary, false, true);
        self.underlying = Some(ws);

        if send_status != SendStatus::Dropped {
            // Notify inspector about client connection
            // SAFETY: JS-thread only; sole `&mut` agent borrow in this scope.
            if let Some(agent) = unsafe { dev.inspector() } {
                self.inspector_connection_id = agent.next_connection_id();
                agent
                    .notify_client_connected(dev.inspector_server_id, self.inspector_connection_id);
            }
        }
    }

    pub fn on_message(&mut self, ws: AnyWebSocket, msg: &[u8], _opcode: Opcode) {
        if msg.is_empty() {
            return ws.close();
        }

        // Zig's IncomingMessageId is non-exhaustive (`_ => ws.close()`), so msg[0] may be any
        // byte. Transmuting an out-of-range u8 into a #[repr(u8)] enum is UB regardless of a
        // wildcard match arm — match on the raw byte instead.
        match msg[0] {
            x if x == IncomingMessageId::Init as u8 => {
                if msg.len() != 9 {
                    return ws.close();
                }
                let mut generation_bytes = [0u8; 4];
                // std.fmt.hexToBytes → bun_core::decode_hex_to_bytes
                if strings::decode_hex_to_bytes(&mut generation_bytes, &msg[1..]).is_err() {
                    return ws.close();
                }
                let generation = u32::from_ne_bytes(generation_bytes);
                let source_map_id = source_map_store::Key::init((generation as u64) << 32);
                let dev = unsafe { self.dev() };
                if dev
                    .source_maps
                    .remove_or_upgrade_weak_ref(source_map_id, RemoveOrUpgradeMode::Upgrade)
                {
                    self.referenced_source_maps
                        .insert(source_map_id, ())
                        // PERF(port): was `catch bun.outOfMemory()` — Rust HashMap aborts on OOM
                        ;
                }
            }
            x if x == IncomingMessageId::Subscribe as u8 => {
                let mut new_bits = HmrTopicBits::empty();
                let topics = &msg[1..];
                if topics.len() > HmrTopic::MAX_COUNT {
                    return;
                }
                // Zig: inline for over @typeInfo(HmrTopic).@"enum".fields, matching
                // `char == field.value` and setting the corresponding bit.
                for &ch in topics {
                    if let Some(topic) = HmrTopic::from_u8(ch) {
                        new_bits.insert(topic.as_bit());
                    }
                }
                // Zig: inline for over std.enums.values(HmrTopic)
                for &field in HmrTopic::ALL {
                    let bit = field.as_bit();
                    if new_bits.contains(bit) && !self.subscriptions.contains(bit) {
                        let _ = ws.subscribe(&[field as u8]);

                        // on-subscribe hooks
                        if feature_flags::BAKE_DEBUGGING_FEATURES {
                            let dev = unsafe { self.dev() };
                            match field {
                                HmrTopic::IncrementalVisualizer => {
                                    dev.emit_incremental_visualizer_events += 1;
                                    dev.emit_visualizer_message_if_needed();
                                }
                                HmrTopic::MemoryVisualizer => {
                                    dev.emit_memory_visualizer_events += 1;
                                    dev.emit_memory_visualizer_message();
                                    if dev.emit_memory_visualizer_events == 1 {
                                        debug_assert!(
                                            dev.memory_visualizer_timer.state
                                                != EventLoopTimerState::ACTIVE
                                        );
                                        // PORT NOTE (b2-cycle): `vm.timer` is `()` on the
                                        // low-tier `VirtualMachine`; the real `timer::All`
                                        // lives in `RuntimeState` (see jsc_hooks.rs).
                                        let state = crate::jsc_hooks::runtime_state();
                                        let next = bun_core::Timespec::ms_from_now(
                                            bun_core::TimespecMockMode::AllowMockedTime,
                                            1000,
                                        );
                                        // SAFETY: `runtime_state()` is non-null after
                                        // `bun_runtime::init()`; JS-thread only, sole
                                        // `&mut` to `timer` in this scope.
                                        unsafe {
                                            (*state).timer.update(
                                                &raw mut dev.memory_visualizer_timer,
                                                &next,
                                            );
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    } else if new_bits.contains(bit) && !self.subscriptions.contains(bit) {
                        // PORT NOTE: this `else if` condition is identical to the `if` above in
                        // the source Zig (line 96) and is therefore unreachable. Ported verbatim;
                        // likely an upstream bug (intended: `!new && old` → unsubscribe).
                        let _ = ws.unsubscribe(&[field as u8]);
                    }
                }
                self.on_unsubscribe(!new_bits & self.subscriptions);
                self.subscriptions = new_bits;
            }
            x if x == IncomingMessageId::SetUrl as u8 => {
                let pattern = &msg[1..];
                let dev = unsafe { self.dev() };
                let maybe_rbi = dev.route_to_bundle_index_slow(pattern);
                // SAFETY: JS-thread only; sole `&mut` agent borrow in this scope.
                if let Some(agent) = unsafe { dev.inspector() } {
                    if self.inspector_connection_id > -1 {
                        let mut pattern_str = bun_core::String::init(pattern);
                        // `defer pattern_str.deref()` → Drop on bun_core::String
                        agent.notify_client_navigated(
                            dev.inspector_server_id,
                            self.inspector_connection_id,
                            &mut pattern_str,
                            maybe_rbi.map(|i| i.get() as i32).unwrap_or(-1),
                        );
                    }
                }
                let Some(rbi) = maybe_rbi else { return };
                if let Some(old) = self.active_route {
                    if old == rbi {
                        return;
                    }
                    dev.route_bundle_ptr(old).active_viewers -= 1;
                }
                dev.route_bundle_ptr(rbi).active_viewers += 1;
                self.active_route = Some(rbi);
                let mut response = [0u8; 5];
                response[0] = MessageId::SetUrlResponse.char();
                response[1..].copy_from_slice(&rbi.get().to_ne_bytes());

                let _ = ws.send(&response, Opcode::Binary, false, true);
                self.notify_inspector_client_navigation(pattern, Some(rbi));
            }
            x if x == IncomingMessageId::TestingBatchEvents as u8 => {
                let dev = unsafe { self.dev() };
                match &dev.testing_batch_events {
                    super::TestingBatchEvents::Disabled => {
                        if dev.current_bundle.is_some() {
                            dev.testing_batch_events = super::TestingBatchEvents::EnableAfterBundle;
                        } else {
                            dev.testing_batch_events =
                                super::TestingBatchEvents::Enabled(Default::default());
                            dev.publish(
                                HmrTopic::TestingWatchSynchronization,
                                &[MessageId::TestingWatchSynchronization.char(), 0],
                                bun_uws::Opcode::BINARY,
                            );
                        }
                    }
                    super::TestingBatchEvents::EnableAfterBundle => {
                        // do not expose a websocket event that panics a release build
                        debug_assert!(false);
                        ws.close();
                    }
                    super::TestingBatchEvents::Enabled(_event_const) => {
                        // PORT NOTE: reshaped for borrowck — Zig copied the payload then
                        // overwrote the union; here we replace-and-extract.
                        let super::TestingBatchEvents::Enabled(mut event) = core::mem::replace(
                            &mut dev.testing_batch_events,
                            super::TestingBatchEvents::Disabled,
                        ) else {
                            unreachable!()
                        };
                        let _ = &mut event;

                        if event.entry_points.set.count() == 0 {
                            dev.publish(
                                HmrTopic::TestingWatchSynchronization,
                                &[MessageId::TestingWatchSynchronization.char(), 2],
                                bun_uws::Opcode::BINARY,
                            );
                            return;
                        }

                        // TODO(port): std.time.Timer — `start_async_bundle` takes Instant.
                        let timer = std::time::Instant::now();
                        dev.start_async_bundle(event.entry_points, true, timer)
                            // bun.handleOom(err) — Rust aborts on OOM by default
                            .expect("OOM");

                        // `event.entry_points.deinit(allocator)` → Drop handles this
                    }
                }
            }
            x if x == IncomingMessageId::ConsoleLog as u8 => {
                if msg.len() < 2 {
                    ws.close();
                    return;
                }

                let kind = match msg[1] {
                    b'l' => ConsoleLogKind::Log,
                    b'e' => ConsoleLogKind::Err,
                    _ => {
                        ws.close();
                        return;
                    }
                };

                let data = &msg[2..];
                let dev = unsafe { self.dev() };

                // SAFETY: JS-thread only; sole `&mut` agent borrow in this scope.
                if let Some(agent) = unsafe { dev.inspector() } {
                    let mut log_str = bun_core::String::init(data);
                    // `defer log_str.deref()` → Drop on bun_core::String
                    agent.notify_console_log(dev.inspector_server_id, kind as u8, &mut log_str);
                }

                if dev.broadcast_console_log_from_browser_to_server {
                    match kind {
                        ConsoleLogKind::Log => {
                            Output::pretty(format_args!(
                                "<r><d>[browser]<r> {}<r>\n",
                                bstr::BStr::new(data)
                            ));
                        }
                        ConsoleLogKind::Err => {
                            Output::pretty_error(format_args!(
                                "<r><d>[browser]<r> {}<r>\n",
                                bstr::BStr::new(data)
                            ));
                        }
                    }
                    Output::flush();
                }
            }
            x if x == IncomingMessageId::UnrefSourceMap as u8 => {
                let payload = &msg[1..];
                let Ok(bytes) = <[u8; 8]>::try_from(payload.get(0..8).unwrap_or(&[])) else {
                    return ws.close();
                };
                let source_map_id = source_map_store::Key::init(u64::from_le_bytes(bytes));
                let Some(kv) = self.referenced_source_maps.remove_entry(&source_map_id) else {
                    Output::debug_warn(format_args!(
                        "unref_source_map: no entry found: {:x}\n",
                        source_map_id.get()
                    ));
                    return; // no entry may happen.
                };
                unsafe { self.dev() }.source_maps.unref(kv.0);
            }
            _ => ws.close(),
        }
    }

    fn on_unsubscribe(&mut self, field: HmrTopicBits) {
        if feature_flags::BAKE_DEBUGGING_FEATURES {
            let dev = unsafe { self.dev() };
            if field.contains(HmrTopic::IncrementalVisualizer.as_bit()) {
                dev.emit_incremental_visualizer_events -= 1;
            }
            if field.contains(HmrTopic::MemoryVisualizer.as_bit()) {
                dev.emit_memory_visualizer_events -= 1;
                if dev.emit_incremental_visualizer_events == 0
                    && dev.memory_visualizer_timer.state == EventLoopTimerState::ACTIVE
                {
                    // PORT NOTE (b2-cycle): `vm.timer` is `()` on the low-tier
                    // `VirtualMachine`; the real `timer::All` lives in `RuntimeState`.
                    let state = crate::jsc_hooks::runtime_state();
                    // SAFETY: `runtime_state()` is non-null after `bun_runtime::init()`;
                    // JS-thread only, sole `&mut` to `timer` in this scope.
                    unsafe {
                        (*state).timer.remove(&raw mut dev.memory_visualizer_timer);
                    }
                }
            }
        }
    }

    pub fn on_close(s: *mut HmrSocket, _ws: AnyWebSocket, _exit_code: i32, _message: &[u8]) {
        // SAFETY: uws guarantees the socket context pointer is valid for the
        // duration of the close callback; we consume ownership here.
        let this = unsafe { &mut *s };

        let subs = this.subscriptions;
        this.on_unsubscribe(subs);

        let dev = unsafe { this.dev() };
        if this.inspector_connection_id > -1 {
            // Notify inspector about client disconnection
            // SAFETY: JS-thread only; sole `&mut` agent borrow in this scope.
            if let Some(agent) = unsafe { dev.inspector() } {
                agent.notify_client_disconnected(
                    dev.inspector_server_id,
                    this.inspector_connection_id,
                );
            }
        }

        if let Some(old) = this.active_route {
            dev.route_bundle_ptr(old).active_viewers -= 1;
        }

        for key in this.referenced_source_maps.keys() {
            dev.source_maps.unref(*key);
        }
        // referenced_source_maps.deinit(allocator) → Drop on HashMap (below)
        let removed = dev.active_websocket_connections.remove(&s);
        debug_assert!(removed.is_some());
        // SAFETY: `s` was heap-allocated in `new()`'s caller; this is the sole
        // owner reclaiming it. Matches `s.dev.arena().destroy(s)`.
        drop(unsafe { bun_core::heap::take(s) });
    }

    fn notify_inspector_client_navigation(
        &self,
        pattern: &[u8],
        rbi: super::route_bundle::IndexOptional,
    ) {
        if self.inspector_connection_id > -1 {
            let dev = unsafe { self.dev() };
            // SAFETY: JS-thread only; sole `&mut` agent borrow in this scope.
            if let Some(agent) = unsafe { dev.inspector() } {
                let mut pattern_str = bun_core::String::init(pattern);
                // `defer pattern_str.deref()` → Drop on bun_core::String
                agent.notify_client_navigated(
                    dev.inspector_server_id,
                    self.inspector_connection_id,
                    &mut pattern_str,
                    rbi.map(|i| i.get() as i32).unwrap_or(-1),
                );
            }
        }
    }
}

// ported from: src/bake/DevServer/HmrSocket.zig
