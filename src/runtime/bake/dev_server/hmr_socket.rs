use bun_collections::HashMap;
use bun_core::strings;
use bun_core::{Output, feature_flags};
use bun_uws::AnyWebSocket;
use bun_uws_sys::{Opcode, SendStatus};

use crate::timer::EventLoopTimerState;

use super::source_map_store::{self, RemoveOrUpgradeMode};
use super::{ConsoleLogKind, DevServer, HmrTopic, IncomingMessageId, MessageId};
use crate::bake::dev_server::HmrTopicBits;

// Struct definition lives in `dev_server/mod.rs` so the public
// `crate::bake::dev_server::HmrSocket` path and these impl blocks name a
// single type (no cross-type pointer casts).
pub(crate) use super::HmrSocket;
use super::*;

impl HmrSocket {
    pub(crate) fn new(dev: &mut DevServer) -> Box<HmrSocket> {
        Box::new(HmrSocket {
            dev: bun_ptr::BackRef::new_mut(dev),
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
    unsafe fn dev<'a>(&self) -> &'a mut DevServer {
        // Detach the borrow from `&self` (explicit unbound `'a`) so callers may
        // interleave `self.*` field access with `dev.*` — DevServer is a
        // separate heap allocation.
        // SAFETY: caller upholds exclusivity; BackRef invariant guarantees liveness.
        unsafe { &mut *self.dev.as_ptr() }
    }

    pub(crate) fn on_open(&mut self, ws: AnyWebSocket) {
        let dev = self.dev;
        let mut header = [0u8; 1 + DevServer::CONFIGURATION_HASH_KEY_LEN];
        header[0] = MessageId::Version.char();
        header[1..].copy_from_slice(&dev.configuration_hash_key);
        let send_status = ws.send(&header, Opcode::Binary, false, true);
        self.underlying = Some(ws);

        if send_status != SendStatus::Dropped {
            // Notify inspector about client connection
            if let Some(agent) = dev.inspector() {
                self.inspector_connection_id = agent.next_connection_id();
                agent
                    .notify_client_connected(dev.inspector_server_id, self.inspector_connection_id);
            }
        }
    }

    pub(crate) fn on_message(&mut self, ws: AnyWebSocket, msg: &[u8], _opcode: Opcode) {
        if msg.is_empty() {
            return ws.close();
        }

        // `msg[0]` may be any byte. Transmuting an out-of-range u8 into a
        // #[repr(u8)] enum is UB regardless of a wildcard match arm — match on
        // the raw byte instead.
        match msg[0] {
            x if x == IncomingMessageId::Init as u8 => {
                if msg.len() != 9 {
                    return ws.close();
                }
                let mut generation_bytes = [0u8; 4];
                if strings::decode_hex_to_bytes(&mut generation_bytes, &msg[1..]).is_err() {
                    return ws.close();
                }
                let generation = u32::from_ne_bytes(generation_bytes);
                let source_map_id = source_map_store::Key::init((generation as u64) << 32);
                // SAFETY: JS-thread only; sole `&mut DevServer` for this scope.
                let dev = unsafe { self.dev() };
                if dev
                    .source_maps
                    .remove_or_upgrade_weak_ref(source_map_id, RemoveOrUpgradeMode::Upgrade)
                {
                    self.referenced_source_maps.insert(source_map_id, ());
                }
            }
            x if x == IncomingMessageId::Subscribe as u8 => {
                let mut new_bits = HmrTopicBits::empty();
                let topics = &msg[1..];
                if topics.len() > HmrTopic::MAX_COUNT {
                    return;
                }
                for &ch in topics {
                    if let Some(topic) = HmrTopic::from_u8(ch) {
                        new_bits.insert(topic.as_bit());
                    }
                }
                for &field in HmrTopic::ALL {
                    let bit = field.as_bit();
                    if new_bits.contains(bit) && !self.subscriptions.contains(bit) {
                        let _ = ws.subscribe(&field.uws_topic());

                        // on-subscribe hooks
                        if feature_flags::BAKE_DEBUGGING_FEATURES {
                            // SAFETY: JS-thread only; sole `&mut DevServer` for this scope.
                            let dev = unsafe { self.dev() };
                            match field {
                                HmrTopic::IncrementalVisualizer => {
                                    dev.emit_incremental_visualizer_events += 1;
                                }
                                HmrTopic::MemoryVisualizer => {
                                    dev.emit_memory_visualizer_events += 1;
                                    dev.emit_memory_visualizer_message();
                                    if dev.emit_memory_visualizer_events == 1 {
                                        debug_assert!(
                                            dev.memory_visualizer_timer.state
                                                != EventLoopTimerState::ACTIVE
                                        );
                                        // Note (jsc/runtime crate cycle): `vm.timer` is `()` on the
                                        // low-tier `VirtualMachine`; the real `timer::All`
                                        // lives in `RuntimeState` (see jsc_hooks.rs).
                                        let state = crate::jsc_hooks::runtime_state();
                                        let next = bun_core::Timespec::ms_from_now(
                                            bun_core::TimespecMockMode::ForceRealTime,
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
                    } else if !new_bits.contains(bit) && self.subscriptions.contains(bit) {
                        let _ = ws.unsubscribe(&field.uws_topic());
                    }
                }
                self.on_unsubscribe(!new_bits & self.subscriptions);
                self.subscriptions = new_bits;
            }
            x if x == IncomingMessageId::SetUrl as u8 => {
                let pattern = &msg[1..];
                // `match_slow` requires an absolute path; these are peer bytes.
                if pattern.first() != Some(&b'/') {
                    return ws.close();
                }
                // SAFETY: JS-thread only; sole `&mut DevServer` for this scope.
                let dev = unsafe { self.dev() };
                let maybe_rbi = dev.route_to_bundle_index_slow(pattern);
                if let Some(agent) = dev.inspector() {
                    if self.inspector_connection_id > -1 {
                        let pattern_str = bun_core::StringView::from_bytes(pattern);
                        agent.notify_client_navigated(
                            dev.inspector_server_id,
                            self.inspector_connection_id,
                            &pattern_str,
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
            }
            x if x == IncomingMessageId::TestingBatchEvents as u8 => {
                // SAFETY: JS-thread only; sole `&mut DevServer` for this scope.
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
                    super::TestingBatchEvents::EnableAfterBundle
                    | super::TestingBatchEvents::ReleaseAfterBundle(_) => {
                        // A duplicate `H` is a protocol violation, not an invariant.
                        ws.close();
                    }
                    super::TestingBatchEvents::Enabled(_event_const) => {
                        // Replace-and-extract to satisfy borrowck.
                        let super::TestingBatchEvents::Enabled(batch) = core::mem::replace(
                            &mut dev.testing_batch_events,
                            super::TestingBatchEvents::Disabled,
                        ) else {
                            unreachable!()
                        };

                        // An unbundled route's request can start a bundle;
                        // `start_async_bundle` requires none in flight.
                        if dev.current_bundle.is_some() {
                            dev.testing_batch_events =
                                super::TestingBatchEvents::ReleaseAfterBundle(batch);
                            return;
                        }

                        dev.release_testing_batch(batch);
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
                let dev = self.dev;

                if let Some(agent) = dev.inspector() {
                    let log_str = bun_core::StringView::from_bytes(data);
                    agent.notify_console_log(dev.inspector_server_id, kind as u8, &log_str);
                }

                if dev.broadcast_console_log_from_browser_to_server {
                    let arena = bun_alloc::Arena::new();
                    let data = super::error_report_request::sanitize_for_terminal(data, &arena);
                    match kind {
                        ConsoleLogKind::Log => {
                            bun_core::pretty!("<r><d>[browser]<r> {}<r>\n", bstr::BStr::new(data));
                        }
                        ConsoleLogKind::Err => {
                            bun_core::pretty_error!(
                                "<r><d>[browser]<r> {}<r>\n",
                                bstr::BStr::new(data)
                            );
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
                    bun_core::debug_warn!(
                        "unref_source_map: no entry found: {:x}\n",
                        source_map_id.get()
                    );
                    return; // no entry may happen.
                };
                // SAFETY: JS-thread only; sole `&mut DevServer` for this scope.
                unsafe { self.dev() }.source_maps.unref(kv.0);
            }
            _ => ws.close(),
        }
    }

    fn on_unsubscribe(&mut self, field: HmrTopicBits) {
        if feature_flags::BAKE_DEBUGGING_FEATURES {
            // SAFETY: JS-thread only; sole `&mut DevServer` for this scope.
            let dev = unsafe { self.dev() };
            if field.contains(HmrTopic::IncrementalVisualizer.as_bit()) {
                dev.emit_incremental_visualizer_events -= 1;
            }
            if field.contains(HmrTopic::MemoryVisualizer.as_bit()) {
                dev.emit_memory_visualizer_events -= 1;
                if dev.emit_memory_visualizer_events == 0
                    && dev.memory_visualizer_timer.state == EventLoopTimerState::ACTIVE
                {
                    // Note (jsc/runtime crate cycle): `vm.timer` is `()` on the low-tier
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

    /// # Safety
    /// `s` must be a valid, uniquely-owned `HmrSocket` heap pointer (allocated
    /// via `HmrSocket::new`'s caller). uws guarantees the socket context
    /// pointer is valid for the duration of the close callback; this function
    /// consumes ownership and frees it.
    pub(crate) fn on_close(s: *mut HmrSocket, _ws: AnyWebSocket, _exit_code: i32, _message: &[u8]) {
        // SAFETY: caller contract above.
        let this = unsafe { &mut *s };

        let subs = this.subscriptions;
        this.on_unsubscribe(subs);

        // SAFETY: JS-thread only; the `on_unsubscribe` borrow above has been
        // released, so this is the sole `&mut DevServer` for the remainder.
        let dev = unsafe { this.dev() };
        if this.inspector_connection_id > -1 {
            // Notify inspector about client disconnection
            if let Some(agent) = dev.inspector() {
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
}

/// `WebSocketBehavior.Wrap(DevServer, HmrSocket, ssl).apply(.{})`.
pub(super) fn hmr_socket_behavior<const SSL: bool>() -> bun_uws_sys::WebSocketBehavior {
    bun_uws_sys::web_socket::Wrap::<DevServer, HmrSocket, SSL>::apply(&Default::default())
}

// `WebSocketBehavior.Wrap(ServerType, Type, ssl)` requires `Type` (= `HmrSocket`)
// to be a `WebSocketHandler` and `ServerType` (= `DevServer`) to be a
// `WebSocketUpgradeServer<SSL>`. The trait is wired explicitly and forward to the inherent method bodies in
// `dev_server::hmr_socket`.
impl bun_uws_sys::web_socket::WebSocketHandler for HmrSocket {
    // `Wrap.apply` leaves the drain/ping/pong C callbacks `null` when
    // `HAS_ON_* == false`.
    const HAS_ON_DRAIN: bool = false;
    const HAS_ON_PING: bool = false;
    const HAS_ON_PONG: bool = false;

    // Note (noalias re-entrancy): the trait now hands the handler a raw
    // `*mut Self` (see `WebSocketHandler` doc). `HmrSocket::on_close` already
    // takes `*mut Self`; `on_open`/`on_message` still take `&mut self` so
    // re-derive a fresh `&mut *this` here (not carried in from a `noalias`
    // dispatch-frame borrow).
    #[inline]
    unsafe fn on_open(this: *mut Self, ws: bun_uws_sys::AnyWebSocket) {
        // SAFETY: `this` is the live user-data pointer (per trait contract).
        HmrSocket::on_open(unsafe { &mut *this }, ws)
    }
    #[inline]
    unsafe fn on_message(
        this: *mut Self,
        ws: bun_uws_sys::AnyWebSocket,
        message: &[u8],
        opcode: bun_uws_sys::Opcode,
    ) {
        // SAFETY: see `on_open`.
        HmrSocket::on_message(unsafe { &mut *this }, ws, message, opcode)
    }
    #[inline]
    unsafe fn on_close(this: *mut Self, ws: bun_uws_sys::AnyWebSocket, code: i32, message: &[u8]) {
        // SAFETY: see `on_open`.
        HmrSocket::on_close(this, ws, code, message)
    }
    unsafe fn on_drain(_this: *mut Self, _ws: bun_uws_sys::AnyWebSocket) {}
    unsafe fn on_ping(_this: *mut Self, _ws: bun_uws_sys::AnyWebSocket, _message: &[u8]) {}
    unsafe fn on_pong(_this: *mut Self, _ws: bun_uws_sys::AnyWebSocket, _message: &[u8]) {}
}

impl<const SSL: bool> bun_uws_sys::web_socket::WebSocketUpgradeServer<SSL> for DevServer {
    unsafe fn on_websocket_upgrade(
        this: *mut Self,
        res: *mut bun_uws_sys::NewAppResponse<SSL>,
        req: &mut Request,
        upgrade_ctx: &mut WebSocketUpgradeContext,
        id: usize,
    ) {
        debug_assert_eq!(id, 0);
        // Note: DevServer always registers `*mut Self` with `id == 0`
        // (`set_routes` → `app.ws(prefix, this, 0, ..)`); live for the upgrade
        // callback's duration. `res.upgrade(..)` synchronously runs `on_open`,
        // which reads the DevServer through the socket's backref, so no
        // `&mut DevServer` may span it — the pre-upgrade borrows below are
        // scoped to their statements. uWS guarantees `res` is non-null and live
        // for the upgrade callback (`Response<SSL>` is an opaque handle); every
        // `&mut *res` below is likewise statement-scoped.
        //
        // SAFETY: `this` is the live DevServer registered for the upgrade callback.
        if !is_allowed_dev_host(unsafe { &*this }, req) {
            // SAFETY: `res` is live for this callback (see Note above).
            host_forbidden(unsafe { &mut *res }.as_any_response());
            return;
        }
        if !is_allowed_dev_origin(req) {
            // SAFETY: `res` is live for this callback (see Note above).
            origin_forbidden(unsafe { &mut *res }.as_any_response());
            return;
        }
        // SAFETY: as above; the borrow is statement-scoped, ending before `upgrade`.
        let dw = bun_core::heap::into_raw(HmrSocket::new(unsafe { &mut *this }));
        // SAFETY: `this` is live (see above).
        let _ = unsafe { (*this).active_websocket_connections.insert(dw, ()) };
        // SAFETY: `res` is live for this callback (see Note above); `on_open`
        // (run synchronously inside `upgrade`) re-derives DevServer, not `res`.
        let socket = unsafe {
            (&mut *res).upgrade(
                dw,
                req.header(b"sec-websocket-key").unwrap_or(b""),
                req.header(b"sec-websocket-protocol").unwrap_or(b""),
                req.header(b"sec-websocket-extension").unwrap_or(b""),
                Some(upgrade_ctx),
            )
        };
        if socket.is_null() {
            // The connection was already closed, so uWS never stored `dw` and `on_close` won't run.
            // SAFETY: `this` is live (see above).
            let _ = unsafe { (*this).active_websocket_connections.remove(&dw) };
            // SAFETY: `dw` was allocated above and nothing else owns it.
            drop(unsafe { bun_core::heap::take(dw) });
        }
    }
}

impl DevServer {
    pub(crate) fn publish(&self, topic: HmrTopic, message: &[u8], opcode: Opcode) {
        if let Some(s) = &self.server {
            let _ = s.publish(&topic.uws_topic(), message, opcode, false);
        }
    }

    pub(crate) fn num_subscribers(&self, topic: HmrTopic) -> u32 {
        if let Some(s) = &self.server {
            s.num_subscribers(&topic.uws_topic())
        } else {
            0
        }
    }

    /// Either of two conditions make this true:
    /// - The inspector is enabled
    /// - The user passed "console": true in serve options
    pub(super) fn should_receive_console_log_from_browser(&self) -> bool {
        self.inspector().is_some() || self.broadcast_console_log_from_browser_to_server
    }
}
