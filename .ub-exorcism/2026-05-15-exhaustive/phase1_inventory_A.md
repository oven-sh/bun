# Section A: runtime-webcore — Phase-1 Unsafe Inventory

Source: prior-audit `/data/projects/bun/.unsafe-audit/unsafe-inventory.jsonl` filtered to `src/runtime/webcore/` (604 rows).
Codex validation on current `origin/main` (`4d443e5402`): all 604 row locations still point to existing files, and every row has an unsafe/UB-relevant token within five source lines. Treat this as a **prior-seeded, current-line-sanity-checked** inventory, not a fresh AST enumeration; Phase 2 should still re-normalize current-source rows before using these counts as final.
Bucket numbers refer to `UB-TAXONOMY.md`. `0` = unclassified-low-risk (no obvious bucket trigger in the normalized text).
SAFETY rule: `PRESENT_STRONG` >40 chars naming invariants; `PRESENT_WEAK` shorter/handwavy; `MISSING` no `// SAFETY:` within 3 lines above (or the body of an `unsafe fn`).
Macro rule: `MACRO_INVOCATION` = site is inside a `*!` invocation block; `MACRO_TEMPLATE` = site is inside a `macro_rules!` body; `SOURCE_DIRECT` otherwise.

| file:line | site_kind | bucket(s) | safety_status | macro_status | prior_id | notes |
|-----------|-----------|-----------|---------------|--------------|----------|-------|
| src/runtime/webcore/ArrayBufferSink.rs:103 | unsafe_block | 1,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009082 | zig_port_self_call | <!-- unsafe { Self::destroy(this) } -->
| src/runtime/webcore/ArrayBufferSink.rs:190 | unsafe_fn | 1,13 | PRESENT_STRONG | SOURCE_DIRECT | S-009083 | bun_heap_lifecycle | <!-- pub unsafe fn destroy(this: *mut Self) { // SAFETY: reclaiming ownersh -->
| src/runtime/webcore/ArrayBufferSink.rs:193 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009084 | bun_heap_lifecycle | <!-- unsafe { bun_core::heap::take(this) } -->
| src/runtime/webcore/BakeResponse.rs:49 | unsafe_fn | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009085 | jsc_object_handle | <!-- pub unsafe fn to_js_for_ssr( this: *mut Response, global_object: &JSGl -->
| src/runtime/webcore/BakeResponse.rs:55 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009086 | zig_port_mut_ref | <!-- unsafe { &mut *this } -->
| src/runtime/webcore/BakeResponse.rs:137 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009087 | other | <!-- unsafe { to_js_for_ssr(ptr, global_this, SSRKind::Redirect) } -->
| src/runtime/webcore/BakeResponse.rs:145 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009088 | zig_port_mut_ref | <!-- unsafe { &mut *ptr } -->
| src/runtime/webcore/BakeResponse.rs:216 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009089 | other | <!-- unsafe { to_js_for_ssr(ptr, global_this, SSRKind::Render) } -->
| src/runtime/webcore/Blob.rs:76 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009090 | other | <!-- unsafe { Store::deref(store) } -->
| src/runtime/webcore/Blob.rs:380 | unsafe_fn | 1,10,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009091 | libc_ffi/ptr_cast | <!-- pub unsafe extern "S" fn Bun__Blob__sharedView(this: *const Blob, len: -->
| src/runtime/webcore/Blob.rs:382 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009092 | raw_method_call | <!-- unsafe { (*this).shared_view() } -->
| src/runtime/webcore/Blob.rs:383 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009093 | other | <!-- unsafe { *len = view.len() } -->
| src/runtime/webcore/Blob.rs:435 | unsafe_block | 0 | PRESENT_WEAK | SOURCE_DIRECT | S-009094 | other | <!-- unsafe { (*handler).promise = jsc::JSPromiseStrong::init(global) } -->
| src/runtime/webcore/Blob.rs:436 | unsafe_block | 0 | PRESENT_WEAK | SOURCE_DIRECT | S-009095 | other | <!-- unsafe { (*handler).promise.value() } -->
| src/runtime/webcore/Blob.rs:474 | unsafe_block | 0 | PRESENT_WEAK | SOURCE_DIRECT | S-009096 | other | <!-- unsafe { (*handler).promise = jsc::JSPromiseStrong::init(global) } -->
| src/runtime/webcore/Blob.rs:475 | unsafe_block | 0 | PRESENT_WEAK | SOURCE_DIRECT | S-009097 | other | <!-- unsafe { (*handler).promise.value() } -->
| src/runtime/webcore/Blob.rs:507 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009098 | zig_port_mut_ref | <!-- unsafe { &mut *c } -->
| src/runtime/webcore/Blob.rs:514 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009099 | bun_heap_lifecycle | <!-- unsafe { bun_core::heap::take(b.buf) } -->
| src/runtime/webcore/Blob.rs:535 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009100 | zig_port_mut_ref | <!-- unsafe { &mut *self.ctx } -->
| src/runtime/webcore/Blob.rs:544 | unsafe_block | 13 | PRESENT_WEAK | SOURCE_DIRECT | S-009101 | ptr_cast | <!-- unsafe { bun_core::heap::take(opaque_self.cast::<Task<H>>()) } -->
| src/runtime/webcore/Blob.rs:597 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009102 | zig_port_shared_ref | <!-- unsafe { &*path } -->
| src/runtime/webcore/Blob.rs:631 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009103 | zig_port_mut_ref | <!-- unsafe { &mut *ctx } -->
| src/runtime/webcore/Blob.rs:762 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009104 | zig_port_mut_ref | <!-- unsafe { &mut *ptr } -->
| src/runtime/webcore/Blob.rs:765 | unsafe_block | 10 | MISSING | SOURCE_DIRECT | S-009105 | bun_ffi_helper | <!-- unsafe { bun_core::ffi::slice(*cursor, total_length) } -->
| src/runtime/webcore/Blob.rs:786 | unsafe_block | 2 | PRESENT_STRONG | SOURCE_DIRECT | S-009106 | ptr_arith | <!-- unsafe { (*cursor).add(buffer_stream.pos) } -->
| src/runtime/webcore/Blob.rs:801 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009107 | ptr_cast/fd_syscall | <!-- unsafe { (*store.as_ptr()).mime_type = bun_http_types::MimeType::Compa -->
| src/runtime/webcore/Blob.rs:864 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009108 | other | <!-- unsafe { bun_ptr::callback_ctx::<FormDataContext<'_>>(ctx_ptr) } -->
| src/runtime/webcore/Blob.rs:867 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009109 | ptr_cast/zig_legacy_str | <!-- unsafe { *value_ptr.cast::<ZigString>() } -->
| src/runtime/webcore/Blob.rs:872 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009110 | ptr_cast | <!-- unsafe { &mut *value_ptr.cast::<Blob>() } -->
| src/runtime/webcore/Blob.rs:877 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009111 | other | <!-- unsafe { *filename } -->
| src/runtime/webcore/Blob.rs:882 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009112 | other | <!-- unsafe { *name_ } -->
| src/runtime/webcore/Blob.rs:1414 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009113 | other | <!-- unsafe { (*global_this.bun_vm().as_mut().transpiler.env).get_http_prox -->
| src/runtime/webcore/Blob.rs:1517 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009114 | fd_syscall | <!-- unsafe { (*sink) .writer .with_mut(\|w\| w.owns_fd = !matches!(pathlike, -->
| src/runtime/webcore/Blob.rs:1528 | unsafe_block | 10 | PRESENT_WEAK | SOURCE_DIRECT | S-009115 | fd_syscall | <!-- unsafe { (*sink).writer.with_mut(\|w\| w.start_sync(fd, false)) } -->
| src/runtime/webcore/Blob.rs:1530 | unsafe_block | 0 | MISSING | SOURCE_DIRECT | S-009116 | other | <!-- unsafe { webcore::FileSink::deref(sink) } -->
| src/runtime/webcore/Blob.rs:1539 | unsafe_block | 10 | PRESENT_WEAK | SOURCE_DIRECT | S-009117 | fd_syscall | <!-- unsafe { (*sink).writer.with_mut(\|w\| w.start(fd, true)) } -->
| src/runtime/webcore/Blob.rs:1541 | unsafe_block | 0 | MISSING | SOURCE_DIRECT | S-009118 | other | <!-- unsafe { webcore::FileSink::deref(sink) } -->
| src/runtime/webcore/Blob.rs:1581 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009119 | other | <!-- unsafe { (*sink).start(stream_start) } -->
| src/runtime/webcore/Blob.rs:1582 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009120 | other | <!-- unsafe { webcore::FileSink::deref(sink) } -->
| src/runtime/webcore/Blob.rs:1595 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009121 | other | <!-- unsafe { &(*file_sink).signal } -->
| src/runtime/webcore/Blob.rs:1611 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009122 | ptr_cast | <!-- unsafe { (&raw mut (*(*file_sink).signal.as_ptr()).ptr).cast::<*mut c_ -->
| src/runtime/webcore/Blob.rs:1616 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009123 | zig_port_mut_ref | <!-- unsafe { &mut *file_sink } -->
| src/runtime/webcore/Blob.rs:1627 | unsafe_block | 0 | PRESENT_WEAK | SOURCE_DIRECT | S-009124 | other | <!-- unsafe { webcore::FileSink::deref(file_sink) } -->
| src/runtime/webcore/Blob.rs:1654 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009125 | other | <!-- unsafe { (*wrapper).promise.value() } -->
| src/runtime/webcore/Blob.rs:1665 | unsafe_block | 0 | PRESENT_WEAK | SOURCE_DIRECT | S-009126 | other | <!-- unsafe { webcore::FileSink::deref(file_sink) } -->
| src/runtime/webcore/Blob.rs:1674 | unsafe_block | 0 | PRESENT_WEAK | SOURCE_DIRECT | S-009127 | other | <!-- unsafe { webcore::FileSink::deref(file_sink) } -->
| src/runtime/webcore/Blob.rs:1684 | unsafe_block | 0 | PRESENT_WEAK | SOURCE_DIRECT | S-009128 | other | <!-- unsafe { webcore::FileSink::deref(file_sink) } -->
| src/runtime/webcore/Blob.rs:1695 | unsafe_block | 0 | PRESENT_WEAK | SOURCE_DIRECT | S-009129 | other | <!-- unsafe { webcore::FileSink::deref(file_sink) } -->
| src/runtime/webcore/Blob.rs:1729 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009130 | other | <!-- unsafe { (*global_this.bun_vm().as_mut().transpiler.env).get_http_prox -->
| src/runtime/webcore/Blob.rs:1877 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009131 | zig_port_mut_ref | <!-- unsafe { &mut *sink } -->
| src/runtime/webcore/Blob.rs:1891 | unsafe_block | 0 | PRESENT_WEAK | SOURCE_DIRECT | S-009132 | other | <!-- unsafe { webcore::FileSink::deref(sink) } -->
| src/runtime/webcore/Blob.rs:1902 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009133 | other | <!-- unsafe { webcore::FileSink::deref(sink) } -->
| src/runtime/webcore/Blob.rs:1950 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009134 | other | <!-- unsafe { (*sink).start(stream_start) } -->
| src/runtime/webcore/Blob.rs:1952 | unsafe_block | 0 | PRESENT_WEAK | SOURCE_DIRECT | S-009135 | other | <!-- unsafe { webcore::FileSink::deref(sink) } -->
| src/runtime/webcore/Blob.rs:1957 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009136 | other | <!-- unsafe { (*sink).to_js(global_this) } -->
| src/runtime/webcore/Blob.rs:1960 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009137 | other | <!-- unsafe { webcore::FileSink::deref(sink) } -->
| src/runtime/webcore/Blob.rs:2007 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009138 | other | <!-- unsafe { BlobExt::to_js(&*ptr, global_this) } -->
| src/runtime/webcore/Blob.rs:2021 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009139 | other | <!-- unsafe { BlobExt::to_js(&*ptr, global_this) } -->
| src/runtime/webcore/Blob.rs:2103 | unsafe_block | 1 | MISSING | SOURCE_DIRECT | S-009140 | zig_port_shared_ref | <!-- unsafe { &*content_type } -->
| src/runtime/webcore/Blob.rs:2261 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009141 | ptr_cast | <!-- unsafe { &*vm.node_fs().cast::<crate::node::node_fs_binding::Binding>( -->
| src/runtime/webcore/Blob.rs:2285 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009142 | ptr_cast | <!-- unsafe { &*vm.node_fs().cast::<crate::node::node_fs_binding::Binding>( -->
| src/runtime/webcore/Blob.rs:2493 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009143 | ptr_cast | <!-- unsafe { (*s.as_ptr()).is_all_ascii = Some(is_all_ascii) } -->
| src/runtime/webcore/Blob.rs:2646 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009144 | other | <!-- unsafe { if matches!((*store).data, store::Data::Bytes(_)) { (*store). -->
| src/runtime/webcore/Blob.rs:2665 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009145 | zig_port_shared_ref | <!-- unsafe { &*raw_bytes } -->
| src/runtime/webcore/Blob.rs:2672 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009146 | bun_heap_lifecycle | <!-- unsafe { drop(bun_core::heap::take(raw_bytes)) } -->
| src/runtime/webcore/Blob.rs:2705 | unsafe_block | 13 | MISSING | SOURCE_DIRECT | S-009147 | bun_heap_lifecycle | <!-- unsafe { drop(bun_core::heap::take(raw_bytes)) } -->
| src/runtime/webcore/Blob.rs:2765 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009148 | bun_heap_lifecycle | <!-- unsafe { drop(bun_core::heap::take(raw_bytes)) } -->
| src/runtime/webcore/Blob.rs:2851 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009149 | zig_port_shared_ref | <!-- unsafe { &*raw_bytes } -->
| src/runtime/webcore/Blob.rs:2854 | unsafe_block | 13 | MISSING | SOURCE_DIRECT | S-009150 | bun_heap_lifecycle | <!-- unsafe { drop(bun_core::heap::take(raw_bytes)) } -->
| src/runtime/webcore/Blob.rs:2873 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009151 | bun_heap_lifecycle | <!-- unsafe { drop(bun_core::heap::take(raw_bytes)) } -->
| src/runtime/webcore/Blob.rs:2925 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009152 | zig_port_shared_ref | <!-- unsafe { &*buf } -->
| src/runtime/webcore/Blob.rs:2962 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009153 | zig_port_shared_ref | <!-- unsafe { &*buf } -->
| src/runtime/webcore/Blob.rs:2981 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009154 | zig_port_shared_ref | <!-- unsafe { &*buf } -->
| src/runtime/webcore/Blob.rs:2989 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009155 | other | <!-- unsafe { (*memfd).ref_() } -->
| src/runtime/webcore/Blob.rs:2995 | unsafe_block | 0 | PRESENT_WEAK | SOURCE_DIRECT | S-009156 | other | <!-- unsafe { (*memfd).fd } -->
| src/runtime/webcore/Blob.rs:3005 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009157 | other | <!-- unsafe { LinuxMemFdAllocator::deref(memfd) } -->
| src/runtime/webcore/Blob.rs:3021 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009158 | zig_port_shared_ref | <!-- unsafe { &*buf } -->
| src/runtime/webcore/Blob.rs:3034 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009159 | zig_port_mut_ref | <!-- unsafe { &mut *buf } -->
| src/runtime/webcore/Blob.rs:3053 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009160 | zig_port_mut_ref | <!-- unsafe { &mut *buf } -->
| src/runtime/webcore/Blob.rs:3065 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009161 | bun_heap_lifecycle | <!-- unsafe { drop(bun_core::heap::take(buf)) } -->
| src/runtime/webcore/Blob.rs:3070 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009162 | zig_port_mut_ref | <!-- unsafe { &mut *buf } -->
| src/runtime/webcore/Blob.rs:3281 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009163 | zig_port_mut_ref | <!-- unsafe { &mut *blob_ptr } -->
| src/runtime/webcore/Blob.rs:3626 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009164 | zig_port_mut_ref | <!-- unsafe { &mut *graph } -->
| src/runtime/webcore/Blob.rs:3671 | unsafe_block | 1,4,9 | PRESENT_STRONG | SOURCE_DIRECT | S-009165 | ptr_cast/pin_unchecked | <!-- unsafe { StoreRef::retained(NonNull::new_unchecked(erased.cast::<Store -->
| src/runtime/webcore/Blob.rs:3907 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009166 | ptr_cast | <!-- unsafe { (self.impl_)(self.ctx, bytes.as_ptr(), bytes.len() as u32) } -->
| src/runtime/webcore/Blob.rs:4049 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009167 | other | <!-- unsafe { (*b).deinit() } -->
| src/runtime/webcore/Blob.rs:4050 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009168 | other | <!-- unsafe { &mut **blob_guard } -->
| src/runtime/webcore/Blob.rs:4108 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009169 | other | <!-- unsafe { BlobExt::to_js(&*blob_ptr, global_this) } -->
| src/runtime/webcore/Blob.rs:4135 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009170 | zig_port_shared_ref | <!-- unsafe { &*this } -->
| src/runtime/webcore/Blob.rs:4294 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009171 | other | <!-- unsafe { (*dest_ptr).detach() } -->
| src/runtime/webcore/Blob.rs:4424 | unsafe_block | 1,13 | PRESENT_STRONG | SOURCE_DIRECT | S-009172 | ptr_cast | <!-- unsafe { bun_core::heap::take(opaque_this.cast::<Wrapper>()) } -->
| src/runtime/webcore/Blob.rs:4531 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009173 | fd_syscall | <!-- unsafe { (*write_file_promise).promise.set(ctx, promise_value) } -->
| src/runtime/webcore/Blob.rs:4565 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009174 | fd_syscall | <!-- unsafe { (*write_file_promise).promise = jsc::JSPromiseStrong::init(ct -->
| src/runtime/webcore/Blob.rs:4566 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009175 | fd_syscall | <!-- unsafe { (*write_file_promise).promise.value() } -->
| src/runtime/webcore/Blob.rs:4638 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009176 | other | <!-- unsafe { BlobExt::to_js(&*cloned, ctx) } -->
| src/runtime/webcore/Blob.rs:4713 | unsafe_block | 1,13 | PRESENT_STRONG | SOURCE_DIRECT | S-009177 | ptr_cast | <!-- unsafe { bun_core::heap::take(opaque_self.cast::<Wrapper>()) } -->
| src/runtime/webcore/Blob.rs:4981 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009178 | zig_port_mut_ref | <!-- unsafe { &mut *body_value } -->
| src/runtime/webcore/Blob.rs:4992 | unsafe_block | 1 | MISSING | SOURCE_DIRECT | S-009179 | zig_port_mut_ref | <!-- unsafe { &mut *body_value } -->
| src/runtime/webcore/Blob.rs:5011 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009180 | zig_port_mut_ref | <!-- unsafe { &mut *body_value } -->
| src/runtime/webcore/Blob.rs:5071 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009181 | zig_port_mut_ref | <!-- unsafe { &mut *body_value } -->
| src/runtime/webcore/Blob.rs:5077 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009182 | other | <!-- unsafe { (*task).promise.value() } -->
| src/runtime/webcore/Blob.rs:5369 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009183 | other | <!-- unsafe { bun_sys::windows::kernel32::SetEndOfFile(fd.native()) } -->
| src/runtime/webcore/Blob.rs:5510 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009184 | other | <!-- unsafe { (*blob_).is_jsdom_file.set(true) } -->
| src/runtime/webcore/Blob.rs:5593 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009185 | other | <!-- unsafe { BlobExt::to_js(&*ptr, global_object) } -->
| src/runtime/webcore/Blob.rs:5651 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009186 | zig_port_mut_ref | <!-- unsafe { &mut *this } -->
| src/runtime/webcore/Blob.rs:5652 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009187 | bun_heap_lifecycle | <!-- unsafe { drop(bun_core::heap::take(p)); } -->
| src/runtime/webcore/Blob.rs:5673 | unsafe_block | 1 | MISSING | SOURCE_DIRECT | S-009188 | zig_port_mut_ref | <!-- unsafe { &mut *bytes } -->
| src/runtime/webcore/Blob.rs:5705 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009189 | zig_port_mut_ref | <!-- unsafe { &mut *this } -->
| src/runtime/webcore/Blob.rs:5803 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009190 | other | <!-- unsafe { webcore::FileSink::deref(self.sink) } -->
| src/runtime/webcore/Blob.rs:5814 | unsafe_block | 2,13 | PRESENT_STRONG | SOURCE_DIRECT | S-009191 | raw_cast | <!-- unsafe { bun_core::heap::take(args.ptr[args.len - N].as_number() as us -->
| src/runtime/webcore/Blob.rs:5834 | unsafe_block | 2,13 | MISSING | SOURCE_DIRECT | S-009192 | raw_cast | <!-- unsafe { bun_core::heap::take(args.ptr[args.len - N].as_number() as us -->
| src/runtime/webcore/Blob.rs:5904 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009193 | other | <!-- unsafe { (*blob).shared_view() } -->
| src/runtime/webcore/Blob.rs:5917 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009194 | other | <!-- unsafe { (*blob).shared_view().len() } -->
| src/runtime/webcore/Blob.rs:5930 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009195 | bun_ffi_helper | <!-- unsafe { bun_core::ffi::slice(ptr, len) } -->
| src/runtime/webcore/Blob.rs:5947 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009196 | other | <!-- unsafe { bun_core::ffi::cstr(mime) } -->
| src/runtime/webcore/Blob.rs:5949 | unsafe_block | 20 | PRESENT_STRONG | SOURCE_DIRECT | S-009197 | ptr_intrinsic/allocator | <!-- unsafe { (*blob) .content_type .set(std::ptr::from_ref::<[u8]>(mime_sl -->
| src/runtime/webcore/Blob.rs:5980 | unsafe_block | 13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009198 | raw_ptr_lifecycle/slice_from_raw | <!-- unsafe { core::slice::from_raw_parts_mut(ptr, len) } -->
| src/runtime/webcore/Blob.rs:5983 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009199 | other | <!-- unsafe { bun_core::ffi::cstr(mime) } -->
| src/runtime/webcore/Blob.rs:5986 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009200 | ptr_intrinsic | <!-- unsafe { (*blob) .content_type .set(std::ptr::from_ref::<[u8]>(mime_sl -->
| src/runtime/webcore/Blob.rs:6125 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009201 | bun_heap_lifecycle | <!-- unsafe { drop(bun_core::heap::take(self.N)) } -->
| src/runtime/webcore/Blob.rs:6336 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009202 | other | <!-- unsafe { (*result).global_this.set(global_this) } -->
| src/runtime/webcore/Blob.rs:6337 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009203 | zig_port_shared_ref | <!-- unsafe { &*result } -->
| src/runtime/webcore/Blob.rs:6658 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009204 | zig_port_shared_ref | <!-- unsafe { &*owned } -->
| src/runtime/webcore/Blob.rs:6902 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009205 | other | <!-- unsafe { bun_ptr::callback_ctx::<S>((*req).data) } -->
| src/runtime/webcore/Blob.rs:6907 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009206 | other | <!-- unsafe { (*req).result } -->
| src/runtime/webcore/Blob.rs:6939 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009207 | other | <!-- unsafe { (*self_ptr).req() } -->
| src/runtime/webcore/Blob.rs:6948 | unsafe_block | 10,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009208 | libuv_ffi/ptr_cast | <!-- unsafe { bun_libuv_sys::uv_fs_open( loop_, req, path.as_ptr(), Self::O -->
| src/runtime/webcore/Body.rs:43 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009338 | other | <!-- unsafe { &**s } -->
| src/runtime/webcore/Body.rs:61 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009339 | ptr_cast | <!-- unsafe { &mut *s.as_ptr() } -->
| src/runtime/webcore/Body.rs:125 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009340 | other | <!-- unsafe { self.value.get_mut() } -->
| src/runtime/webcore/Body.rs:705 | unsafe_fn | 1,2 | PRESENT_STRONG | SOURCE_DIRECT | S-009341 | ptr_intrinsic | <!-- pub unsafe fn unref(&mut self) -> Option<&mut Self> { // SAFETY: calle -->
| src/runtime/webcore/Body.rs:707 | unsafe_block | 1,2 | PRESENT_STRONG | SOURCE_DIRECT | S-009342 | ptr_intrinsic | <!-- unsafe { &mut *bun_core::from_field_ptr!(HiveRef, value, std::ptr::fro -->
| src/runtime/webcore/Body.rs:714 | unsafe_fn | 1,2 | PRESENT_STRONG | SOURCE_DIRECT | S-009343 | ptr_intrinsic | <!-- pub unsafe fn ref_(&mut self) -> &mut Self { // SAFETY: caller contrac -->
| src/runtime/webcore/Body.rs:716 | unsafe_block | 1,2 | PRESENT_STRONG | SOURCE_DIRECT | S-009344 | ptr_intrinsic | <!-- unsafe { &mut *bun_core::from_field_ptr!(HiveRef, value, std::ptr::fro -->
| src/runtime/webcore/Body.rs:1027 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009345 | zig_port_mut_ref | <!-- unsafe { &mut *form_data } -->
| src/runtime/webcore/Body.rs:1036 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009346 | zig_port_mut_ref | <!-- unsafe { &mut *search_params } -->
| src/runtime/webcore/Body.rs:1060 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009347 | other | <!-- unsafe { encoded.bytes.as_ref() } -->
| src/runtime/webcore/Body.rs:1081 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009348 | other | <!-- unsafe { (*blob).to_any_blob(global_this) } -->
| src/runtime/webcore/Body.rs:1212 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009349 | zig_port_mut_ref | <!-- unsafe { &mut *blob_ptr } -->
| src/runtime/webcore/Body.rs:2226 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009350 | zig_port_mut_ref | <!-- unsafe { &mut *blob_ptr } -->
| src/runtime/webcore/Body.rs:2407 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009351 | zig_port_mut_ref | <!-- unsafe { &mut *sink } -->
| src/runtime/webcore/Body.rs:2445 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009352 | raw_ptr_lifecycle | <!-- unsafe { Box::<[u8]>::from_raw(data.buf) } -->
| src/runtime/webcore/Body.rs:2494 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009353 | other | <!-- unsafe { p.as_mut() } -->
| src/runtime/webcore/Body.rs:2582 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009354 | ptr_intrinsic/ptr_cast | <!-- unsafe { &mut *std::ptr::from_mut::<ArrayBufferJSSink>(buffer_stream). -->
| src/runtime/webcore/Body.rs:2741 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009355 | other | <!-- unsafe { bun_ptr::callback_ctx::<Self>(ctx) } -->
| src/runtime/webcore/ByteBlobLoader.rs:175 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009356 | ptr_cast | <!-- unsafe { (*store.as_ptr()).to_any_blob() } -->
| src/runtime/webcore/ByteStream.rs:289 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009357 | zig_port_mut_ref | <!-- unsafe { &mut *self.pending_buffer.get() } -->
| src/runtime/webcore/Crypto.rs:246 | unsafe_block | 13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009358 | raw_ptr_lifecycle/slice_from_raw | <!-- unsafe { slice::from_raw_parts(a_ptr, len) } -->
| src/runtime/webcore/Crypto.rs:247 | unsafe_block | 13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009359 | raw_ptr_lifecycle/slice_from_raw | <!-- unsafe { slice::from_raw_parts(b_ptr, len) } -->
| src/runtime/webcore/Crypto.rs:289 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009360 | bun_ffi_helper | <!-- unsafe { bun_core::ffi::slice_mut(array.ptr(), array.len()) } -->
| src/runtime/webcore/FileReader.rs:70 | unsafe_cell_decl | 0 | MISSING | SOURCE_DIRECT | S-009420 | unsafe_cell | <!-- UnsafeCell::new(IOReader::init::<FileReader>()) -->
| src/runtime/webcore/FileReader.rs:316 | unsafe_block | 1 | MISSING | SOURCE_DIRECT | S-009421 | fd_syscall | <!-- unsafe { &mut *self.reader.get() } -->
| src/runtime/webcore/FileReader.rs:337 | unsafe_cell_decl | 0 | MISSING | SOURCE_DIRECT | S-009422 | unsafe_cell | <!-- UnsafeCell::new(IOReader::init::<FileReader>()) -->
| src/runtime/webcore/FileReader.rs:424 | unsafe_block | 0 | PRESENT_WEAK | SOURCE_DIRECT | S-009423 | other | <!-- unsafe { (*self.parent()).increment_count() } -->
| src/runtime/webcore/FileReader.rs:447 | unsafe_block | 0 | PRESENT_WEAK | SOURCE_DIRECT | S-009424 | other | <!-- unsafe { (*self.parent()).increment_count() } -->
| src/runtime/webcore/FileReader.rs:510 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009425 | other | <!-- unsafe { (*self.parent()).global_this } -->
| src/runtime/webcore/FileReader.rs:619 | unsafe_block | 1,2 | PRESENT_STRONG | SOURCE_DIRECT | S-009426 | raw_cast | <!-- unsafe { &mut *(&mut in_progress[buf.len()..] as *mut [u8]) } -->
| src/runtime/webcore/FileReader.rs:655 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009427 | fd_syscall | <!-- unsafe { mem::take(&mut *reader_buffer) } -->
| src/runtime/webcore/FileReader.rs:689 | unsafe_block | 10 | PRESENT_WEAK | SOURCE_DIRECT | S-009428 | fd_syscall | <!-- unsafe { (*reader_buffer).clear() } -->
| src/runtime/webcore/FileReader.rs:708 | unsafe_block | 10 | PRESENT_WEAK | SOURCE_DIRECT | S-009429 | fd_syscall | <!-- unsafe { &*reader_buffer } -->
| src/runtime/webcore/FileReader.rs:712 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009430 | fd_syscall | <!-- unsafe { mem::take(&mut *reader_buffer) } -->
| src/runtime/webcore/FileReader.rs:720 | unsafe_block | 10 | PRESENT_WEAK | SOURCE_DIRECT | S-009431 | fd_syscall | <!-- unsafe { (*reader_buffer).clear() } -->
| src/runtime/webcore/FileReader.rs:762 | unsafe_block | 10 | PRESENT_WEAK | SOURCE_DIRECT | S-009432 | fd_syscall | <!-- unsafe { &*reader_buffer } -->
| src/runtime/webcore/FileReader.rs:763 | unsafe_block | 10 | PRESENT_WEAK | SOURCE_DIRECT | S-009433 | fd_syscall | <!-- unsafe { (*reader_buffer).clear() } -->
| src/runtime/webcore/FileReader.rs:769 | unsafe_block | 10 | PRESENT_WEAK | SOURCE_DIRECT | S-009434 | fd_syscall | <!-- unsafe { (*reader_buffer).len() } -->
| src/runtime/webcore/FileReader.rs:982 | unsafe_block | 21 | PRESENT_WEAK | SOURCE_DIRECT | S-009435 | fd_syscall | <!-- unsafe { (*self.parent()).on_close() } -->
| src/runtime/webcore/FileReader.rs:991 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009436 | other | <!-- unsafe { Source::decrement_count(parent) } -->
| src/runtime/webcore/FileReader.rs:1079 | unsafe_block | 1,2 | PRESENT_STRONG | SOURCE_DIRECT | S-009437 | raw_cast | <!-- unsafe { &mut *(buf as *mut [u8]) } -->
| src/runtime/webcore/FileSink.rs:102 | unsafe_fn | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009438 | raw_method_call | <!-- unsafe fn new_ref(this: *mut FileSink) -> Self { // SAFETY: caller con -->
| src/runtime/webcore/FileSink.rs:105 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009439 | raw_method_call | <!-- unsafe { (*this).ref_() } -->
| src/runtime/webcore/FileSink.rs:117 | unsafe_fn | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009440 | other | <!-- unsafe fn adopt(this: *mut FileSink) -> Self { Self(this) } -->
| src/runtime/webcore/FileSink.rs:127 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009441 | other | <!-- unsafe { FileSink::deref(self.N) } -->
| src/runtime/webcore/FileSink.rs:173 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009442 | ptr_cast | <!-- unsafe { (*ptr.cast::<FileSink>()).magic.get() } -->
| src/runtime/webcore/FileSink.rs:175 | unsafe_block | 3 | MISSING | SOURCE_DIRECT | S-009443 | ptr_intrinsic/ptr_cast/fd_syscall | <!-- unsafe { core::ptr::read_unaligned(ptr.cast::<[u8; N]>()) } -->
| src/runtime/webcore/FileSink.rs:315 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009444 | other | <!-- unsafe { &(*this_ptr).sink } -->
| src/runtime/webcore/FileSink.rs:336 | unsafe_block | 1,2,10 | PRESENT_STRONG | SOURCE_DIRECT | S-009445 | libuv_ffi/raw_cast | <!-- unsafe { uv::uv_stream_set_blocking( (&mut **pipe) as *mut uv::Pipe as -->
| src/runtime/webcore/FileSink.rs:350 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009446 | libuv_ffi/ptr_cast | <!-- unsafe { uv::uv_stream_set_blocking(tty.as_ptr().cast::<uv::uv_stream_ -->
| src/runtime/webcore/FileSink.rs:386 | unsafe_fn | 1,21 | MISSING | SOURCE_DIRECT | S-009447 | fd_syscall | <!-- pub unsafe fn on_attached_process_exit(this: *mut FileSink, status: &S -->
| src/runtime/webcore/FileSink.rs:388 | unsafe_block | 1,21 | MISSING | SOURCE_DIRECT | S-009448 | fd_syscall | <!-- unsafe { // `writer.close()` below re-enters `onClose` which releases  -->
| src/runtime/webcore/FileSink.rs:442 | unsafe_fn | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009449 | raw_method_call | <!-- unsafe fn run_pending(this: *mut FileSink) { unsafe { let _guard = Fil -->
| src/runtime/webcore/FileSink.rs:443 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009450 | raw_method_call | <!-- unsafe { let _guard = FileSinkRef::new_ref(this); (*this).run_pending_ -->
| src/runtime/webcore/FileSink.rs:464 | unsafe_fn | 1,21 | MISSING | SOURCE_DIRECT | S-009451 | fd_syscall | <!-- pub unsafe fn on_write(this: *mut FileSink, amount: usize, status: Wri -->
| src/runtime/webcore/FileSink.rs:466 | unsafe_block | 1 | MISSING | SOURCE_DIRECT | S-009452 | fd_syscall | <!-- unsafe { // `runPending()` below drains microtasks and may drop the JS -->
| src/runtime/webcore/FileSink.rs:541 | unsafe_fn | 1,20,21 | MISSING | SOURCE_DIRECT | S-009453 | c_alloc/fd_syscall | <!-- pub unsafe fn on_error(this: *mut FileSink, err: sys::Error) { bun_cor -->
| src/runtime/webcore/FileSink.rs:543 | unsafe_block | 1,20 | MISSING | SOURCE_DIRECT | S-009454 | c_alloc/fd_syscall | <!-- unsafe { if (*this).pending.get().state == streams::PendingState::Pend -->
| src/runtime/webcore/FileSink.rs:580 | unsafe_fn | 1,21 | MISSING | SOURCE_DIRECT | S-009455 | fd_syscall | <!-- pub unsafe fn on_ready(this: *mut FileSink) { bun_core::scoped_log!(Fi -->
| src/runtime/webcore/FileSink.rs:582 | unsafe_block | 1 | MISSING | SOURCE_DIRECT | S-009456 | fd_syscall | <!-- unsafe { (*this).signal.with_mut(\|s\| s.ready(None, None)) } -->
| src/runtime/webcore/FileSink.rs:589 | unsafe_fn | 1,20,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009457 | c_alloc/fd_syscall | <!-- pub unsafe fn on_close(this: *mut FileSink) { bun_core::scoped_log!(Fi -->
| src/runtime/webcore/FileSink.rs:591 | unsafe_block | 1,20,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009458 | c_alloc/fd_syscall | <!-- unsafe { // SAFETY(JsCell): `Strong::has`/`get` are read-only on the G -->
| src/runtime/webcore/FileSink.rs:620 | unsafe_fn | 1 | MISSING | SOURCE_DIRECT | S-009459 | raw_method_call | <!-- unsafe fn clear_keep_alive_ref(this: *mut FileSink) { unsafe { if (*th -->
| src/runtime/webcore/FileSink.rs:621 | unsafe_block | 1 | MISSING | SOURCE_DIRECT | S-009460 | raw_method_call | <!-- unsafe { if (*this).must_be_kept_alive_until_eof.get() { (*this).must_ -->
| src/runtime/webcore/FileSink.rs:643 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009461 | other | <!-- unsafe { (*pipe).fd() } -->
| src/runtime/webcore/FileSink.rs:651 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009462 | fd_syscall | <!-- unsafe { (*this).writer.get_mut().set_pipe(pipe); (*this).writer.get_m -->
| src/runtime/webcore/FileSink.rs:672 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009463 | fd_syscall | <!-- unsafe { (*this).writer.get_mut().set_parent(this); } -->
| src/runtime/webcore/FileSink.rs:680 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009464 | fd_syscall | <!-- unsafe { self.readable_stream.get_mut() } -->
| src/runtime/webcore/FileSink.rs:846 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009465 | ptr_cast | <!-- unsafe { &mut *p.cast::<bun_jsc::VirtualMachineRef>() } -->
| src/runtime/webcore/FileSink.rs:929 | unsafe_fn | 1,21 | MISSING | SOURCE_DIRECT | S-009466 | fd_syscall | <!-- pub unsafe fn on_auto_flush(this: *mut FileSink) -> bool { unsafe { if -->
| src/runtime/webcore/FileSink.rs:930 | unsafe_block | 1,21 | MISSING | SOURCE_DIRECT | S-009467 | fd_syscall | <!-- unsafe { if (*this).done.get() \|\| !(*this).writer.get().has_pending_da -->
| src/runtime/webcore/FileSink.rs:1021 | unsafe_block | 1,2,13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009468 | raw_ptr_lifecycle/ptr_cast/slice_from_raw | <!-- unsafe { core::slice::from_raw_parts( (self as *const Self).cast::<u8> -->
| src/runtime/webcore/FileSink.rs:1176 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009469 | ptr_intrinsic | <!-- unsafe { FileSink::deref(std::ptr::from_mut::<Self>(self)) } -->
| src/runtime/webcore/FileSink.rs:1199 | unsafe_block | 1 | MISSING | SOURCE_DIRECT | S-009470 | fd_syscall | <!-- unsafe { (*this).writer.get_mut().set_parent(this); } -->
| src/runtime/webcore/FileSink.rs:1213 | unsafe_block | 0 | MISSING | SOURCE_DIRECT | S-009471 | other | <!-- unsafe { (*bun_jsc::VirtualMachineRef::get()).event_loop() } -->
| src/runtime/webcore/FileSink.rs:1292 | unsafe_fn | 1,2,7,13 | PRESENT_STRONG | SOURCE_DIRECT | S-009472 | atomic/fd_syscall | <!-- unsafe fn deinit(this: *mut FileSink) { LIVE_COUNT.fetch_sub(N, Orderi -->
| src/runtime/webcore/FileSink.rs:1295 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009473 | zig_port_mut_ref | <!-- unsafe { &mut *this } -->
| src/runtime/webcore/FileSink.rs:1338 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009474 | bun_heap_lifecycle | <!-- unsafe { bun_core::heap::take(this) } -->
| src/runtime/webcore/FileSink.rs:1397 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009475 | other | <!-- unsafe { self.pending.get_mut() } -->
| src/runtime/webcore/FileSink.rs:1400 | unsafe_block | 0 | MISSING | SOURCE_DIRECT | S-009476 | other | <!-- unsafe { (*promise_result).to_js() } -->
| src/runtime/webcore/FileSink.rs:1485 | unsafe_block | 0 | MISSING | SOURCE_DIRECT | S-009477 | other | <!-- unsafe { self.signal.get_mut() } -->
| src/runtime/webcore/FileSink.rs:1593 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009478 | other | <!-- unsafe { (*flush_pending).has.replace(false) } -->
| src/runtime/webcore/FileSink.rs:1596 | unsafe_block | 2 | PRESENT_STRONG | SOURCE_DIRECT | S-009479 | other | <!-- unsafe { bun_core::from_field_ptr!(FileSink, run_pending_later, flush_ -->
| src/runtime/webcore/FileSink.rs:1599 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009480 | other | <!-- unsafe { FileSinkRef::adopt(this) } -->
| src/runtime/webcore/FileSink.rs:1604 | unsafe_block | 0 | MISSING | SOURCE_DIRECT | S-009481 | other | <!-- unsafe { FileSink::run_pending(this) } -->
| src/runtime/webcore/FileSink.rs:1640 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009482 | other | <!-- unsafe { FileSinkRef::adopt(this) } -->
| src/runtime/webcore/FileSink.rs:1642 | unsafe_block | 1 | MISSING | SOURCE_DIRECT | S-009483 | raw_method_call | <!-- unsafe { (*this).handle_resolve_stream(global_this) } -->
| src/runtime/webcore/FileSink.rs:1653 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009484 | other | <!-- unsafe { FileSinkRef::adopt(this) } -->
| src/runtime/webcore/FileSink.rs:1655 | unsafe_block | 1 | MISSING | SOURCE_DIRECT | S-009485 | raw_method_call | <!-- unsafe { (*this).handle_reject_stream(global_this, err) } -->
| src/runtime/webcore/FileSink.rs:1667 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009486 | ptr_intrinsic | <!-- unsafe { FileSinkRef::new_ref(std::ptr::from_mut::<FileSink>(self)) } -->
| src/runtime/webcore/FileSink.rs:1684 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009487 | ptr_cast | <!-- unsafe { (&raw mut (*self.signal.as_ptr()).ptr).cast::<*mut c_void>()  -->
| src/runtime/webcore/FileSink.rs:1714 | unsafe_block | 0 | MISSING | SOURCE_DIRECT | S-009488 | other | <!-- unsafe { (*js_promise).status() } -->
| src/runtime/webcore/FileSink.rs:1737 | unsafe_block | 0 | MISSING | SOURCE_DIRECT | S-009489 | other | <!-- unsafe { (*js_promise).result(global_this.vm()) } -->
| src/runtime/webcore/FormData.rs:223 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009490 | zig_port_shared_ref | <!-- unsafe { &*field.value } -->
| src/runtime/webcore/ObjectURLRegistry.rs:68 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009491 | zig_port_mut_ref | <!-- unsafe { &mut *vm } -->
| src/runtime/webcore/ObjectURLRegistry.rs:100 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009492 | other | <!-- unsafe { (*blob).to_js(global_object) } -->
| src/runtime/webcore/ReadableStream.rs:186 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009494 | zig_port_mut_ref | <!-- unsafe { &mut *blobby } -->
| src/runtime/webcore/ReadableStream.rs:229 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009495 | other | <!-- unsafe { (*(*source).parent()).cancel() } -->
| src/runtime/webcore/ReadableStream.rs:230 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009496 | other | <!-- unsafe { (*(*source).parent()).cancel() } -->
| src/runtime/webcore/ReadableStream.rs:231 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009497 | other | <!-- unsafe { (*(*source).parent()).cancel() } -->
| src/runtime/webcore/ReadableStream.rs:836 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009498 | zig_port_mut_ref | <!-- unsafe { &mut *Self::new(init) } -->
| src/runtime/webcore/ReadableStream.rs:907 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009499 | ptr_cast | <!-- unsafe { &mut *(ptr.unwrap().cast::<NewSource<C>>()) } -->
| src/runtime/webcore/ReadableStream.rs:928 | unsafe_fn | 1,13 | PRESENT_STRONG | SOURCE_DIRECT | S-009500 | raw_ptr_lifecycle/smart_ptr_raw/fd_syscall | <!-- pub unsafe fn decrement_count(this: *mut Self) -> u32 { // SAFETY: cal -->
| src/runtime/webcore/ReadableStream.rs:930 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009501 | raw_method_call | <!-- unsafe { let r = &mut (*this).ref_count; #[cfg(debug_assertions)] if * -->
| src/runtime/webcore/ReadableStream.rs:941 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009502 | fd_syscall | <!-- unsafe { (*this).close_jsvalue.deinit(); (*this).context.deinit_fn();  -->
| src/runtime/webcore/ReadableStream.rs:948 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009503 | bun_heap_lifecycle | <!-- unsafe { bun_core::heap::take(this) } -->
| src/runtime/webcore/ReadableStream.rs:1094 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009504 | ptr_intrinsic/ptr_cast/jsc_object_handle | <!-- unsafe { jsc::c_api::JSObjectSetPropertyAtIndex( std::ptr::from_ref::< -->
| src/runtime/webcore/ReadableStream.rs:1205 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009505 | raw_method_call | <!-- unsafe { (*this).this_jsvalue = JSValue::ZERO } -->
| src/runtime/webcore/ReadableStream.rs:1207 | unsafe_block | 1,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009506 | zig_port_self_call | <!-- unsafe { Self::decrement_count(this) } -->
| src/runtime/webcore/Request.rs:39 | unsafe_fn | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009507 | ptr_intrinsic | <!-- unsafe fn weak_ptr_data(this: *mut Self) -> *mut WeakPtrData { // SAFE -->
| src/runtime/webcore/Request.rs:41 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009508 | ptr_intrinsic | <!-- unsafe { core::ptr::addr_of_mut!((*this).weak_ptr_data) } -->
| src/runtime/webcore/Request.rs:70 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009509 | other | <!-- unsafe { Request::to_js(&*ptr, global) } -->
| src/runtime/webcore/Request.rs:235 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009510 | ptr_cast | <!-- unsafe { &mut *self.body.as_ptr() } -->
| src/runtime/webcore/Request.rs:259 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009511 | other | <!-- unsafe { self.headers.get_mut() } -->
| src/runtime/webcore/Request.rs:304 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009512 | other | <!-- unsafe { &(*blob).content_type } -->
| src/runtime/webcore/Request.rs:317 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009513 | zig_port_shared_ref | <!-- unsafe { &*content_type_ } -->
| src/runtime/webcore/Request.rs:757 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009514 | other | <!-- unsafe { bun_ptr::detach_lifetime(content_type.slice()) } -->
| src/runtime/webcore/Request.rs:866 | unsafe_block | 13,20 | PRESENT_STRONG | SOURCE_DIRECT | S-009515 | raw_ptr_lifecycle/smart_ptr_raw | <!-- unsafe { Box::from_raw(this) } -->
| src/runtime/webcore/Request.rs:1088 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009516 | ptr_cast | <!-- unsafe { (*body.as_ptr()).unref() } -->
| src/runtime/webcore/Request.rs:1160 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009517 | zig_port_shared_ref | <!-- unsafe { &*request } -->
| src/runtime/webcore/Request.rs:1229 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009518 | zig_port_mut_ref | <!-- unsafe { &mut *response } -->
| src/runtime/webcore/Request.rs:1245 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009519 | other | <!-- unsafe { HeadersRef::adopt(p) } -->
| src/runtime/webcore/Request.rs:1516 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009520 | zig_port_shared_ref | <!-- unsafe { &*ct_ptr } -->
| src/runtime/webcore/Request.rs:1559 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009521 | other | <!-- unsafe { (*cloned_ptr).to_js(global_this) } -->
| src/runtime/webcore/Request.rs:1576 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009522 | zig_port_mut_ref | <!-- unsafe { &mut *vm } -->
| src/runtime/webcore/Request.rs:1588 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009523 | ptr_cast | <!-- unsafe { (*body.as_ptr()).unref() } -->
| src/runtime/webcore/Request.rs:1612 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009524 | ptr_intrinsic/fd_syscall | <!-- unsafe { core::ptr::write( req, Request { url: OwnedStringCell::new(ur -->
| src/runtime/webcore/Response.rs:63 | unsafe_fn | 4 | MISSING | SOURCE_DIRECT | S-009525 | other | <!-- pub unsafe fn adopt(ptr: NonNull<FetchHeaders>) -> Self { Self(ptr) } -->
| src/runtime/webcore/Response.rs:84 | unsafe_block | 1,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009526 | zig_port_self_call | <!-- unsafe { Self::adopt(FetchHeaders::create_empty()) } -->
| src/runtime/webcore/Response.rs:91 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009527 | uws_ffi | <!-- unsafe { Self::adopt(FetchHeaders::create_from_uws(uws_request)) } -->
| src/runtime/webcore/Response.rs:98 | unsafe_block | 1,21 | PRESENT_WEAK | SOURCE_DIRECT | S-009528 | zig_port_self_call | <!-- unsafe { Self::adopt(p) } -->
| src/runtime/webcore/Response.rs:107 | unsafe_block | 1,21 | PRESENT_WEAK | SOURCE_DIRECT | S-009529 | zig_port_self_call | <!-- unsafe { Self::adopt(p) } -->
| src/runtime/webcore/Response.rs:229 | unsafe_fn | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009530 | ptr_intrinsic | <!-- unsafe fn weak_ptr_data(this: *mut Self) -> *mut WeakPtrData { // SAFE -->
| src/runtime/webcore/Response.rs:231 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009531 | ptr_intrinsic | <!-- unsafe { core::ptr::addr_of_mut!((*this).weak_ptr_data) } -->
| src/runtime/webcore/Response.rs:379 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009532 | other | <!-- unsafe { self.init.get_mut() } -->
| src/runtime/webcore/Response.rs:835 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009533 | other | <!-- unsafe { self.body.get_mut() } -->
| src/runtime/webcore/Response.rs:861 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009534 | other | <!-- unsafe { (*ptr).to_js(global_object) } -->
| src/runtime/webcore/Response.rs:889 | unsafe_block | 1,2,11,13 | PRESENT_STRONG | SOURCE_DIRECT | S-009535 | ptr_cast/jsc_object_handle | <!-- unsafe { // Mirrors Zig `destroy` (Response.zig:N-N): `init.deinit()`  -->
| src/runtime/webcore/Response.rs:927 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009536 | raw_method_call | <!-- unsafe { (*this).ref_count.set((*this).ref_count.get() + N); } -->
| src/runtime/webcore/Response.rs:935 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009537 | raw_method_call | <!-- unsafe { let rc = (*this).ref_count.get(); debug_assert!(rc > N); (*th -->
| src/runtime/webcore/Response.rs:1077 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009538 | other | <!-- unsafe { (*ptr).to_js(global_this) } -->
| src/runtime/webcore/Response.rs:1104 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009539 | other | <!-- unsafe { (*ptr).to_js(global_this) } -->
| src/runtime/webcore/Response.rs:1193 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009540 | other | <!-- unsafe { (*response).to_js(global_this) } -->
| src/runtime/webcore/Response.rs:1195 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009541 | other | <!-- unsafe { (*response).js_ref.set(JsRef::init_weak(js_value)) } -->
| src/runtime/webcore/Response.rs:1335 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009542 | zig_port_shared_ref | <!-- unsafe { &*response } -->
| src/runtime/webcore/Response.rs:1412 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009543 | zig_port_mut_ref | <!-- unsafe { &mut *req } -->
| src/runtime/webcore/Response.rs:1424 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009544 | zig_port_shared_ref | <!-- unsafe { &*resp } -->
| src/runtime/webcore/Response.rs:1444 | unsafe_block | 0 | MISSING | SOURCE_DIRECT | S-009545 | other | <!-- unsafe { HeadersRef::adopt(p) } -->
| src/runtime/webcore/ResumableSink.rs:135 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009546 | fd_syscall | <!-- unsafe { (*ctx).write_request_data(bytes) } -->
| src/runtime/webcore/ResumableSink.rs:140 | unsafe_block | 10 | PRESENT_WEAK | SOURCE_DIRECT | S-009547 | fd_syscall | <!-- unsafe { (*ctx).write_end_request(err) } -->
| src/runtime/webcore/ResumableSink.rs:174 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009548 | zig_port_mut_ref | <!-- unsafe { &mut *this } -->
| src/runtime/webcore/ResumableSink.rs:195 | unsafe_block | 1,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009549 | zig_port_self_call | <!-- unsafe { Self::deref_(this) } -->
| src/runtime/webcore/ResumableSink.rs:228 | unsafe_block | 1,21 | PRESENT_WEAK | SOURCE_DIRECT | S-009550 | zig_port_self_call | <!-- unsafe { Self::deref_(this) } -->
| src/runtime/webcore/ResumableSink.rs:395 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009551 | other | <!-- unsafe { (*global_object.bun_vm().as_mut().event_loop()).run_callback( -->
| src/runtime/webcore/ResumableSink.rs:437 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009552 | other | <!-- unsafe { (*global_object.bun_vm().as_mut().event_loop()).run_callback( -->
| src/runtime/webcore/ResumableSink.rs:478 | unsafe_block | 1,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009553 | zig_port_self_call | <!-- unsafe { Self::deref_(this) } -->
| src/runtime/webcore/ResumableSink.rs:558 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009554 | other | <!-- unsafe { if !js_is_strong { // no js attached, so we can just deref Se -->
| src/runtime/webcore/ResumableSink.rs:573 | unsafe_fn | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009555 | other | <!-- pub unsafe fn deref_(this: *mut Self) { // SAFETY: forwarded caller co -->
| src/runtime/webcore/ResumableSink.rs:575 | unsafe_block | 0 | PRESENT_WEAK | SOURCE_DIRECT | S-009556 | other | <!-- unsafe { <Self as bun_ptr::CellRefCounted>::deref(this) } -->
| src/runtime/webcore/S3Client.rs:382 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009630 | zig_port_mut_ref | <!-- unsafe { &mut *blob } -->
| src/runtime/webcore/S3File.rs:553 | unsafe_block | 1,13 | MISSING | SOURCE_DIRECT | S-009631 | ptr_cast | <!-- unsafe { bun_core::heap::take(this.cast::<S3BlobStatTask>()) } -->
| src/runtime/webcore/S3File.rs:587 | unsafe_block | 1,13 | MISSING | SOURCE_DIRECT | S-009632 | ptr_cast | <!-- unsafe { bun_core::heap::take(this.cast::<S3BlobStatTask>()) } -->
| src/runtime/webcore/S3File.rs:616 | unsafe_block | 1,13 | MISSING | SOURCE_DIRECT | S-009633 | ptr_cast | <!-- unsafe { bun_core::heap::take(this.cast::<S3BlobStatTask>()) } -->
| src/runtime/webcore/S3File.rs:656 | unsafe_block | 1 | MISSING | SOURCE_DIRECT | S-009634 | zig_port_mut_ref | <!-- unsafe { &mut *this } -->
| src/runtime/webcore/S3File.rs:684 | unsafe_block | 1 | MISSING | SOURCE_DIRECT | S-009635 | zig_port_mut_ref | <!-- unsafe { &mut *this } -->
| src/runtime/webcore/S3File.rs:711 | unsafe_block | 1 | MISSING | SOURCE_DIRECT | S-009636 | zig_port_mut_ref | <!-- unsafe { &mut *this } -->
| src/runtime/webcore/S3File.rs:926 | unsafe_block | 1 | MISSING | SOURCE_DIRECT | S-009637 | zig_port_mut_ref | <!-- unsafe { &mut *blob } -->
| src/runtime/webcore/S3File.rs:1001 | unsafe_block | 0 | MISSING | SOURCE_DIRECT | S-009638 | other | <!-- unsafe { (&*this, &*global) } -->
| src/runtime/webcore/S3File.rs:1014 | unsafe_block | 1 | MISSING | SOURCE_DIRECT | S-009639 | other | <!-- unsafe { (&mut *this, &*global, &*callframe) } -->
| src/runtime/webcore/S3File.rs:1028 | unsafe_block | 1 | MISSING | SOURCE_DIRECT | S-009640 | other | <!-- unsafe { (&mut *this, &*global, &*callframe) } -->
| src/runtime/webcore/ScriptExecutionContext.rs:22 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009641 | zig_port_shared_ref | <!-- unsafe { &*p } -->
| src/runtime/webcore/Sink.rs:61 | unsafe_block | 1,2 | PRESENT_STRONG | SOURCE_DIRECT | S-009642 | raw_cast | <!-- unsafe { Sink { ptr: &mut *(N as *mut ()), vtable: VTable::PENDING, st -->
| src/runtime/webcore/Sink.rs:166 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009643 | ptr_intrinsic/ptr_cast | <!-- unsafe { &mut *std::ptr::from_mut::<T>(handler).cast::<()>() } -->
| src/runtime/webcore/Sink.rs:357 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009644 | ptr_cast | <!-- unsafe { &mut *this.cast::<W>() } -->
| src/runtime/webcore/Sink.rs:361 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009645 | ptr_cast | <!-- unsafe { &mut *this.cast::<W>() } -->
| src/runtime/webcore/Sink.rs:368 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009646 | ptr_cast | <!-- unsafe { &mut *this.cast::<W>() } -->
| src/runtime/webcore/Sink.rs:375 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009647 | ptr_cast | <!-- unsafe { &mut *this.cast::<W>() } -->
| src/runtime/webcore/Sink.rs:379 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009648 | ptr_cast | <!-- unsafe { &mut *this.cast::<W>() } -->
| src/runtime/webcore/Sink.rs:844 | unsafe_block | 1,2 | PRESENT_STRONG | SOURCE_DIRECT | S-009649 | raw_cast | <!-- unsafe { &mut *(ptr as *mut JSSink<T>) } -->
| src/runtime/webcore/Sink.rs:863 | unsafe_block | 4,5 | PRESENT_STRONG | SOURCE_DIRECT | S-009650 | maybe_uninit | <!-- unsafe { this.assume_init() } -->
| src/runtime/webcore/Sink.rs:1232 | unsafe_block | 1,2 | PRESENT_STRONG | SOURCE_DIRECT | S-009651 | raw_cast | <!-- unsafe { &mut *(ptr.as_uintptr() as usize as *mut Subprocess<'_>) } -->
| src/runtime/webcore/TextDecoder.rs:70 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009671 | ptr_cast | <!-- unsafe { TextCodec::destroy(self.N.as_ptr()) } -->
| src/runtime/webcore/TextEncoder.rs:30 | unsafe_block | 13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009672 | raw_ptr_lifecycle/slice_from_raw | <!-- unsafe { core::slice::from_raw_parts(ptr, len) } -->
| src/runtime/webcore/TextEncoder.rs:76 | unsafe_block | 13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009673 | raw_ptr_lifecycle/slice_from_raw | <!-- unsafe { core::slice::from_raw_parts(ptr, len) } -->
| src/runtime/webcore/TextEncoder.rs:123 | unsafe_block | 13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009674 | raw_ptr_lifecycle/slice_from_raw | <!-- unsafe { core::slice::from_raw_parts(ptr, len) } -->
| src/runtime/webcore/TextEncoder.rs:187 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009675 | ptr_cast | <!-- unsafe { let it = &mut *it; let this = &mut *it.data_ptr().cast::<Rope -->
| src/runtime/webcore/TextEncoder.rs:199 | unsafe_block | 2,13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009676 | raw_ptr_lifecycle/slice_from_raw | <!-- unsafe { core::slice::from_raw_parts(ptr, len as usize) } -->
| src/runtime/webcore/TextEncoder.rs:221 | unsafe_block | 2,13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009677 | raw_ptr_lifecycle/slice_from_raw | <!-- unsafe { core::slice::from_raw_parts(ptr, len as usize) } -->
| src/runtime/webcore/TextEncoder.rs:315 | unsafe_block | 13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009678 | raw_ptr_lifecycle/slice_from_raw | <!-- unsafe { core::slice::from_raw_parts_mut(buf_ptr, buf_len) } -->
| src/runtime/webcore/TextEncoder.rs:317 | unsafe_block | 13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009679 | raw_ptr_lifecycle/slice_from_raw | <!-- unsafe { core::slice::from_raw_parts(input_ptr, input_len) } -->
| src/runtime/webcore/TextEncoder.rs:341 | unsafe_block | 13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009680 | raw_ptr_lifecycle/slice_from_raw | <!-- unsafe { core::slice::from_raw_parts_mut(buf_ptr, buf_len) } -->
| src/runtime/webcore/TextEncoder.rs:343 | unsafe_block | 13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009681 | raw_ptr_lifecycle/slice_from_raw | <!-- unsafe { core::slice::from_raw_parts(input_ptr, input_len) } -->
| src/runtime/webcore/TextEncoderStreamEncoder.rs:99 | unsafe_block | 2 | PRESENT_STRONG | SOURCE_DIRECT | S-009682 | other | <!-- unsafe { bun_core::vec::fill_spare(&mut buffer, N, \|spare\| { let r = s -->
| src/runtime/webcore/TextEncoderStreamEncoder.rs:205 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009683 | other | <!-- unsafe { bun_core::vec::fill_spare(&mut buf, N, \|spare\| { let r = simd -->
| src/runtime/webcore/blob/Store.rs:368 | unsafe_block | 1,13 | PRESENT_STRONG | SOURCE_DIRECT | S-009259 | ptr_cast | <!-- unsafe { bun_core::heap::take(opaque_self.cast::<Wrapper>()) } -->
| src/runtime/webcore/blob/Store.rs:416 | unsafe_block | 4 | PRESENT_STRONG | SOURCE_DIRECT | S-009260 | other | <!-- unsafe { StoreRef::retained(NonNull::from(store)) } -->
| src/runtime/webcore/blob/Store.rs:454 | unsafe_block | 1,13 | PRESENT_STRONG | SOURCE_DIRECT | S-009261 | ptr_cast | <!-- unsafe { bun_core::heap::take(opaque_self.cast::<Wrapper>()) } -->
| src/runtime/webcore/blob/Store.rs:517 | unsafe_block | 4 | PRESENT_STRONG | SOURCE_DIRECT | S-009262 | other | <!-- unsafe { StoreRef::retained(NonNull::from(store)) } -->
| src/runtime/webcore/blob/Store.rs:526 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009263 | other | <!-- unsafe { &(*wrapper).resolved_list_options } -->
| src/runtime/webcore/blob/Store.rs:557 | unsafe_block | 13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009264 | raw_ptr_lifecycle/ptr_intrinsic/ptr_cast | <!-- unsafe { Bytes::from_raw_parts( slice.as_mut_ptr(), slice.len() as Siz -->
| src/runtime/webcore/blob/Store.rs:593 | unsafe_block | 6,13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009265 | raw_ptr_lifecycle/ptr_cast/slice_from_raw | <!-- unsafe { Vec::from_raw_parts(ptr.as_ptr(), len, cap) } -->
| src/runtime/webcore/blob/Store.rs:624 | unsafe_block | 1,4,9 | PRESENT_STRONG | SOURCE_DIRECT | S-009266 | ptr_cast/pin_unchecked | <!-- unsafe { Store::deref(NonNull::new_unchecked(blob.cast::<Store>())) } -->
| src/runtime/webcore/blob/copy_file.rs:366 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009209 | libc_ffi | <!-- unsafe { libc::ftruncate( dest_fd.native(), i64::try_from(total_writte -->
| src/runtime/webcore/blob/copy_file.rs:382 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009210 | ptr_intrinsic | <!-- unsafe { linux::copy_file_range( src_fd.native(), core::ptr::null_mut( -->
| src/runtime/webcore/blob/copy_file.rs:395 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009211 | ptr_intrinsic | <!-- unsafe { linux::sendfile( dest_fd.native(), src_fd.native(), core::ptr -->
| src/runtime/webcore/blob/copy_file.rs:406 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009212 | libc_ffi/ptr_intrinsic | <!-- unsafe { libc::splice( src_fd.native(), core::ptr::null_mut(), dest_fd -->
| src/runtime/webcore/blob/copy_file.rs:441 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009213 | libc_ffi | <!-- unsafe { libc::ftruncate( dest_fd.native(), i64::try_from(total_writte -->
| src/runtime/webcore/blob/copy_file.rs:463 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009214 | libc_ffi | <!-- unsafe { libc::fcntl(dest_fd.native(), libc::F_GETFL, N as c_int) } -->
| src/runtime/webcore/blob/copy_file.rs:466 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009215 | libc_ffi | <!-- unsafe { libc::fcntl( dest_fd.native(), libc::F_SETFL, flags ^ bun_sys -->
| src/runtime/webcore/blob/copy_file.rs:498 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009216 | libc_ffi | <!-- unsafe { libc::ftruncate( dest_fd.native(), i64::try_from(total_writte -->
| src/runtime/webcore/blob/copy_file.rs:709 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009217 | ptr_cast | <!-- unsafe { bun_sys::c::truncate( self.destination_file_store .pathlike . -->
| src/runtime/webcore/blob/copy_file.rs:890 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009218 | other | <!-- unsafe { bun_sys::darwin::ftruncate( self.destination_fd.native(), i64 -->
| src/runtime/webcore/blob/copy_file.rs:1081 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009219 | libuv_ffi/ptr_intrinsic/fd_syscall | <!-- unsafe { libuv::uv_fs_read( loop_, &mut self.io_request, source_fd.uv( -->
| src/runtime/webcore/blob/copy_file.rs:1144 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009220 | ptr_cast | <!-- unsafe { &mut *(*req).data.cast::<CopyFileWindows>() } -->
| src/runtime/webcore/blob/copy_file.rs:1170 | unsafe_block | 5 | PRESENT_STRONG | SOURCE_DIRECT | S-009221 | fd_syscall | <!-- unsafe { read_buf.set_len(n) } -->
| src/runtime/webcore/blob/copy_file.rs:1183 | unsafe_block | 10,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009222 | libuv_ffi/ptr_intrinsic/fd_syscall | <!-- unsafe { libuv::uv_fs_write( event_loop.uv_loop(), &mut this.io_reques -->
| src/runtime/webcore/blob/copy_file.rs:1207 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009223 | ptr_cast | <!-- unsafe { &mut *(*req).data.cast::<CopyFileWindows>() } -->
| src/runtime/webcore/blob/copy_file.rs:1248 | unsafe_block | 10,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009224 | libuv_ffi/ptr_intrinsic/fd_syscall | <!-- unsafe { libuv::uv_fs_write( this.event_loop.uv_loop(), &mut this.io_r -->
| src/runtime/webcore/blob/copy_file.rs:1322 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009225 | zig_port_mut_ref | <!-- unsafe { &mut *result } -->
| src/runtime/webcore/blob/copy_file.rs:1541 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009226 | libuv_ffi/ptr_cast | <!-- unsafe { libuv::uv_fs_copyfile( loop_, &mut self.io_request, old_path. -->
| src/runtime/webcore/blob/copy_file.rs:1579 | unsafe_block | 2,14,23 | PRESENT_STRONG | SOURCE_DIRECT | S-009227 | raw_cast | <!-- unsafe { jsc::event_loop::EventLoop::enter_scope(self.event_loop as *c -->
| src/runtime/webcore/blob/copy_file.rs:1583 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009228 | ptr_intrinsic | <!-- unsafe { Self::destroy(core::ptr::from_mut(self)) } -->
| src/runtime/webcore/blob/copy_file.rs:1626 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009229 | libuv_ffi | <!-- unsafe { libuv::uv_fs_chmod( loop_, &mut self.io_request, path_ptr, i3 -->
| src/runtime/webcore/blob/copy_file.rs:1665 | unsafe_block | 2,14,23 | PRESENT_STRONG | SOURCE_DIRECT | S-009230 | raw_cast | <!-- unsafe { jsc::event_loop::EventLoop::enter_scope(self.event_loop as *c -->
| src/runtime/webcore/blob/copy_file.rs:1670 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009231 | ptr_intrinsic | <!-- unsafe { Self::destroy(core::ptr::from_mut(self)) } -->
| src/runtime/webcore/blob/copy_file.rs:1692 | unsafe_fn | 1,13 | PRESENT_STRONG | SOURCE_DIRECT | S-009232 | fd_syscall | <!-- pub unsafe fn destroy(this: *mut Self) { // SAFETY: caller contract —  -->
| src/runtime/webcore/blob/copy_file.rs:1694 | unsafe_block | 1,13 | PRESENT_STRONG | SOURCE_DIRECT | S-009233 | fd_syscall | <!-- unsafe { (*this).read_write_loop.close(); // destination_file_store.de -->
| src/runtime/webcore/blob/copy_file.rs:1757 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009234 | ptr_cast | <!-- unsafe { &mut *(*req).data.cast::<CopyFileWindows>() } -->
| src/runtime/webcore/blob/copy_file.rs:1805 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009235 | ptr_cast | <!-- unsafe { &mut *(*req).data.cast::<CopyFileWindows>() } -->
| src/runtime/webcore/blob/copy_file.rs:1830 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009236 | other | <!-- unsafe { bun_ptr::callback_ctx::<CopyFileWindows>(ctx.cast()) } -->
| src/runtime/webcore/blob/copy_file.rs:1842 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009237 | raw_method_call | <!-- unsafe { (*this).on_mkdirp_complete() } -->
| src/runtime/webcore/blob/read_file.rs:89 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009238 | bun_heap_lifecycle | <!-- unsafe { bun_core::heap::take(handler) } -->
| src/runtime/webcore/blob/read_file.rs:119 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009239 | zig_port_mut_ref | <!-- unsafe { &mut *promise } -->
| src/runtime/webcore/blob/read_file.rs:160 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009240 | raw_method_call | <!-- unsafe { (*this).run(task) } -->
| src/runtime/webcore/blob/read_file.rs:164 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009241 | bun_heap_lifecycle | <!-- unsafe { bun_core::heap::take(this) } -->
| src/runtime/webcore/blob/read_file.rs:271 | unsafe_block | 1,2 | PRESENT_STRONG | SOURCE_DIRECT | S-009242 | ptr_intrinsic | <!-- unsafe { &mut *(bun_core::from_field_ptr!( ReadFile, io_request, std:: -->
| src/runtime/webcore/blob/read_file.rs:280 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009243 | other | <!-- unsafe { bun_ptr::callback_ctx::<ReadFile>(ctx.cast()) } -->
| src/runtime/webcore/blob/read_file.rs:300 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009244 | zig_port_mut_ref | <!-- unsafe { &mut *ReadFile::from_task_ptr(task) } -->
| src/runtime/webcore/blob/read_file.rs:398 | unsafe_block | 1,2 | PRESENT_STRONG | SOURCE_DIRECT | S-009245 | other | <!-- unsafe { &mut *(bun_core::from_field_ptr!(ReadFile, io_request, reques -->
| src/runtime/webcore/blob/read_file.rs:442 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009246 | ptr_cast | <!-- unsafe { (*ctx.cast::<ReadFile>()).on_io_error(err) } -->
| src/runtime/webcore/blob/read_file.rs:449 | unsafe_block | 1,2 | PRESENT_STRONG | SOURCE_DIRECT | S-009247 | ptr_intrinsic | <!-- unsafe { &mut *(bun_core::from_field_ptr!( ReadFile, io_request, std:: -->
| src/runtime/webcore/blob/read_file.rs:514 | unsafe_block | 13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009248 | raw_ptr_lifecycle/slice_from_raw | <!-- unsafe { core::slice::from_raw_parts_mut(buffer.N, buffer.N) } -->
| src/runtime/webcore/blob/read_file.rs:778 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009249 | zig_port_mut_ref | <!-- unsafe { &mut *ReadFile::from_task_ptr(task) } -->
| src/runtime/webcore/blob/read_file.rs:831 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009250 | fd_syscall | <!-- unsafe { bun_core::vec::commit_spare(&mut self.buffer, read_amount) } -->
| src/runtime/webcore/blob/read_file.rs:1057 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009251 | zig_port_shared_ref | <!-- unsafe { &*event_loop } -->
| src/runtime/webcore/blob/read_file.rs:1088 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009252 | other | <!-- unsafe { (*this_ptr).get_fd(Self::on_file_open) } -->
| src/runtime/webcore/blob/read_file.rs:1096 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009253 | bun_heap_lifecycle | <!-- unsafe { bun_core::heap::take(this) } -->
| src/runtime/webcore/blob/read_file.rs:1165 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009254 | libuv_ffi/fd_syscall | <!-- unsafe { libuv::uv_fs_fstat( self.loop_, &mut self.req, opened_fd.uv() -->
| src/runtime/webcore/blob/read_file.rs:1190 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009255 | other | <!-- unsafe { bun_ptr::callback_ctx::<ReadFileUV>((*req).data) } -->
| src/runtime/webcore/blob/read_file.rs:1350 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009256 | libuv_ffi/ptr_cast/fd_syscall | <!-- unsafe { libuv::uv_fs_read( self.loop_, &mut self.req, self.opened_fd. -->
| src/runtime/webcore/blob/read_file.rs:1384 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009257 | other | <!-- unsafe { bun_ptr::callback_ctx::<ReadFileUV>((*req).data) } -->
| src/runtime/webcore/blob/read_file.rs:1412 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009258 | libuv_ffi | <!-- unsafe { this.buffer .uv_commit(usize::try_from(result.int()).expect(" -->
| src/runtime/webcore/blob/write_file.rs:39 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009267 | raw_method_call | <!-- unsafe { (*this).run(task) } -->
| src/runtime/webcore/blob/write_file.rs:184 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009268 | ptr_intrinsic | <!-- unsafe { &mut *WriteFile::from_io_request(std::ptr::from_mut(request)) -->
| src/runtime/webcore/blob/write_file.rs:187 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009269 | other | <!-- unsafe { bun_ptr::callback_ctx::<WriteFile>(ctx.cast()) } -->
| src/runtime/webcore/blob/write_file.rs:207 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009270 | zig_port_mut_ref | <!-- unsafe { &mut *WriteFile::from_task_ptr(task) } -->
| src/runtime/webcore/blob/write_file.rs:221 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009271 | ptr_intrinsic | <!-- unsafe { &mut *WriteFile::from_io_request(std::ptr::from_mut(request)) -->
| src/runtime/webcore/blob/write_file.rs:237 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009272 | other | <!-- unsafe { bun_ptr::callback_ctx::<WriteFile>(this.cast()) } -->
| src/runtime/webcore/blob/write_file.rs:251 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009273 | ptr_intrinsic | <!-- unsafe { &mut *WriteFile::from_io_request(std::ptr::from_mut(request)) -->
| src/runtime/webcore/blob/write_file.rs:377 | unsafe_block | 1,13,21 | MISSING | SOURCE_DIRECT | S-009274 | fd_syscall | <!-- unsafe { cb = (*this).on_complete_callback; cb_ctx = (*this).on_comple -->
| src/runtime/webcore/blob/write_file.rs:441 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009275 | other | <!-- unsafe { bun_jsc::work_task::WorkTask::on_finish(io_task) } -->
| src/runtime/webcore/blob/write_file.rs:521 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009276 | zig_port_mut_ref | <!-- unsafe { &mut *WriteFile::from_task_ptr(task) } -->
| src/runtime/webcore/blob/write_file.rs:693 | unsafe_block | 1,4,10 | PRESENT_STRONG | SOURCE_DIRECT | S-009277 | libuv_ffi/ptr_cast/fd_syscall | <!-- unsafe { (*write_file).io_request.loop_ = (*event_loop).uv_loop(); (*w -->
| src/runtime/webcore/blob/write_file.rs:762 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009278 | libuv_ffi | <!-- unsafe { (*self.event_loop).uv_loop() } -->
| src/runtime/webcore/blob/write_file.rs:769 | unsafe_fn | 1,10,20,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009279 | libuv_ffi/ptr_cast/allocator | <!-- pub unsafe fn open(this: *mut Self) -> Result<(), WriteFileWindowsErro -->
| src/runtime/webcore/blob/write_file.rs:771 | unsafe_block | 1,10 | PRESENT_WEAK | SOURCE_DIRECT | S-009280 | ptr_cast | <!-- unsafe { (*this).io_request.data = this.cast::<c_void>() } -->
| src/runtime/webcore/blob/write_file.rs:774 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009281 | raw_method_call | <!-- unsafe { &(*this).file_blob } -->
| src/runtime/webcore/blob/write_file.rs:788 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009282 | syscall/fd_syscall | <!-- unsafe { Self::throw( this, sys::Error { errno: sys::E::NAMETOOLONG as -->
| src/runtime/webcore/blob/write_file.rs:802 | unsafe_block | 1,10 | PRESENT_STRONG | SOURCE_DIRECT | S-009283 | libuv_ffi/ptr_cast | <!-- unsafe { uv::uv_fs_open( (*this).loop_(), &mut (*this).io_request, pos -->
| src/runtime/webcore/blob/write_file.rs:824 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009284 | syscall/fd_syscall | <!-- unsafe { Self::throw( this, sys::Error { errno: err as _, path, syscal -->
| src/runtime/webcore/blob/write_file.rs:837 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009285 | raw_method_call | <!-- unsafe { (*this).owned_fd = true } -->
| src/runtime/webcore/blob/write_file.rs:847 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009286 | other | <!-- unsafe { WriteFileWindows::from_uv_fs(req) } -->
| src/runtime/webcore/blob/write_file.rs:854 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009287 | raw_method_call | <!-- unsafe { (*this).io_request.result } -->
| src/runtime/webcore/blob/write_file.rs:877 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009288 | raw_method_call | <!-- unsafe { (*this).mkdirp_if_not_exists } -->
| src/runtime/webcore/blob/write_file.rs:881 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009289 | other | <!-- unsafe { (*req).deinit() } -->
| src/runtime/webcore/blob/write_file.rs:885 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009290 | raw_method_call | <!-- unsafe { (*this).mkdirp() } -->
| src/runtime/webcore/blob/write_file.rs:890 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009291 | raw_method_call | <!-- unsafe { &(*this).file_blob } -->
| src/runtime/webcore/blob/write_file.rs:902 | unsafe_block | 10 | PRESENT_WEAK | SOURCE_DIRECT | S-009292 | syscall/fd_syscall | <!-- unsafe { Self::throw( this, sys::Error { errno: err as _, path, syscal -->
| src/runtime/webcore/blob/write_file.rs:920 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009293 | raw_method_call | <!-- unsafe { (*this).fd = i32::try_from(rc.int()).expect("S") } -->
| src/runtime/webcore/blob/write_file.rs:924 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009294 | fd_syscall | <!-- unsafe { Self::do_write_loop(this, (*this).loop_()) } -->
| src/runtime/webcore/blob/write_file.rs:978 | unsafe_fn | 1,20 | PRESENT_WEAK | SOURCE_DIRECT | S-009295 | c_alloc/fd_syscall | <!-- unsafe fn on_mkdirp_complete(this: *mut Self) { // SAFETY: caller cont -->
| src/runtime/webcore/blob/write_file.rs:980 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009296 | raw_method_call | <!-- unsafe { (*this).err.take() } -->
| src/runtime/webcore/blob/write_file.rs:985 | unsafe_block | 1,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009297 | zig_port_self_call | <!-- unsafe { Self::throw(this, err_) } -->
| src/runtime/webcore/blob/write_file.rs:993 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009298 | fd_syscall | <!-- unsafe { Self::open(this) } -->
| src/runtime/webcore/blob/write_file.rs:1009 | unsafe_block | 1,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009299 | zig_port_self_call | <!-- unsafe { Self::on_mkdirp_complete(this) } -->
| src/runtime/webcore/blob/write_file.rs:1016 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009300 | other | <!-- unsafe { bun_ptr::callback_ctx::<WriteFileWindows>(ctx.cast()) } -->
| src/runtime/webcore/blob/write_file.rs:1024 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009301 | other | <!-- unsafe { (*this.event_loop).enqueue_task_concurrent(ConcurrentTask::cr -->
| src/runtime/webcore/blob/write_file.rs:1036 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009302 | other | <!-- unsafe { WriteFileWindows::from_uv_fs(req) } -->
| src/runtime/webcore/blob/write_file.rs:1043 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009303 | raw_method_call | <!-- unsafe { (*this).io_request.result } -->
| src/runtime/webcore/blob/write_file.rs:1046 | unsafe_block | 10 | PRESENT_WEAK | SOURCE_DIRECT | S-009304 | syscall/fd_syscall | <!-- unsafe { Self::throw( this, sys::Error { errno: err, syscall: sys::Tag -->
| src/runtime/webcore/blob/write_file.rs:1063 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009305 | raw_method_call | <!-- unsafe { (*this).total_written += usize::try_from(rc.int()).expect("S" -->
| src/runtime/webcore/blob/write_file.rs:1065 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009306 | fd_syscall | <!-- unsafe { Self::do_write_loop(this, (*this).loop_()) } -->
| src/runtime/webcore/blob/write_file.rs:1076 | unsafe_fn | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009307 | fd_syscall | <!-- pub unsafe fn on_finish(this: *mut Self) -> WriteFileWindowsError { // -->
| src/runtime/webcore/blob/write_file.rs:1080 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009308 | raw_method_call | <!-- unsafe { jsc::event_loop::EventLoop::enter_scope((*this).event_loop) } -->
| src/runtime/webcore/blob/write_file.rs:1084 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009309 | fd_syscall | <!-- unsafe { Self::run_from_js_thread(this) } -->
| src/runtime/webcore/blob/write_file.rs:1090 | unsafe_fn | 1,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009310 | fd_syscall | <!-- pub unsafe fn run_from_js_thread(this: *mut Self) -> WriteFileWindowsE -->
| src/runtime/webcore/blob/write_file.rs:1093 | unsafe_block | 1,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009311 | raw_method_call | <!-- unsafe { ((*this).on_complete_callback, (*this).on_complete_ctx) } -->
| src/runtime/webcore/blob/write_file.rs:1096 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009312 | raw_method_call | <!-- unsafe { (*this).to_system_error() } -->
| src/runtime/webcore/blob/write_file.rs:1098 | unsafe_block | 1,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009313 | zig_port_self_call | <!-- unsafe { Self::deinit(this) } -->
| src/runtime/webcore/blob/write_file.rs:1104 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009314 | raw_method_call | <!-- unsafe { (*this).total_written } -->
| src/runtime/webcore/blob/write_file.rs:1106 | unsafe_block | 1,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009315 | zig_port_self_call | <!-- unsafe { Self::deinit(this) } -->
| src/runtime/webcore/blob/write_file.rs:1118 | unsafe_fn | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009316 | raw_method_call | <!-- pub unsafe fn throw(this: *mut Self, err: sys::Error) -> WriteFileWind -->
| src/runtime/webcore/blob/write_file.rs:1120 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009317 | raw_method_call | <!-- unsafe { debug_assert!((*this).err.is_none()); (*this).err = Some(err) -->
| src/runtime/webcore/blob/write_file.rs:1153 | unsafe_fn | 1,10,20,21 | PRESENT_WEAK | SOURCE_DIRECT | S-009318 | libuv_ffi/ptr_cast/allocator | <!-- pub unsafe fn do_write_loop( this: *mut Self, uv_loop: *mut uv::Loop,  -->
| src/runtime/webcore/blob/write_file.rs:1158 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009319 | raw_method_call | <!-- unsafe { (*this).bytes_blob.shared_view() } -->
| src/runtime/webcore/blob/write_file.rs:1160 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009320 | raw_method_call | <!-- unsafe { (*this).total_written } -->
| src/runtime/webcore/blob/write_file.rs:1164 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009321 | raw_method_call | <!-- unsafe { (*this).err.is_some() } -->
| src/runtime/webcore/blob/write_file.rs:1166 | unsafe_block | 1,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009322 | zig_port_self_call | <!-- unsafe { Self::on_finish(this) } -->
| src/runtime/webcore/blob/write_file.rs:1170 | unsafe_block | 1,10 | PRESENT_WEAK | SOURCE_DIRECT | S-009323 | libuv_ffi/ptr_cast | <!-- unsafe { (*this).uv_bufs[N].base = remain.as_ptr().cast_mut(); (*this) -->
| src/runtime/webcore/blob/write_file.rs:1177 | unsafe_block | 1,10 | PRESENT_STRONG | SOURCE_DIRECT | S-009324 | libuv_ffi | <!-- unsafe { uv::uv_fs_req_cleanup(&mut (*this).io_request) } -->
| src/runtime/webcore/blob/write_file.rs:1180 | unsafe_block | 1,10,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009325 | libuv_ffi/ptr_cast/fd_syscall | <!-- unsafe { uv::uv_fs_write( uv_loop, &mut (*this).io_request, (*this).fd -->
| src/runtime/webcore/blob/write_file.rs:1192 | unsafe_block | 1,10 | PRESENT_WEAK | SOURCE_DIRECT | S-009326 | ptr_cast | <!-- unsafe { (*this).io_request.data = this.cast::<c_void>() } -->
| src/runtime/webcore/blob/write_file.rs:1200 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009327 | syscall/fd_syscall | <!-- unsafe { Self::throw( this, sys::Error { errno: err as _, syscall: sys -->
| src/runtime/webcore/blob/write_file.rs:1234 | unsafe_fn | 1,10,13,20 | PRESENT_WEAK | SOURCE_DIRECT | S-009328 | libuv_ffi/raw_ptr_lifecycle/allocator | <!-- pub unsafe fn deinit(this: *mut Self) { // SAFETY: caller contract — ` -->
| src/runtime/webcore/blob/write_file.rs:1236 | unsafe_block | 1,10,13,20 | PRESENT_WEAK | SOURCE_DIRECT | S-009329 | libuv_ffi/raw_ptr_lifecycle/allocator | <!-- unsafe { let fd = (*this).fd; if fd > N && (*this).owned_fd { aio::Clo -->
| src/runtime/webcore/blob/write_file.rs:1288 | unsafe_block | 1,13 | PRESENT_STRONG | SOURCE_DIRECT | S-009330 | ptr_intrinsic | <!-- unsafe { let h = &mut *handler; let promise = std::ptr::from_mut::<JSP -->
| src/runtime/webcore/blob/write_file.rs:1296 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009331 | zig_port_mut_ref | <!-- unsafe { &mut *promise } -->
| src/runtime/webcore/blob/write_file.rs:1337 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009332 | zig_port_mut_ref | <!-- unsafe { &mut *this } -->
| src/runtime/webcore/blob/write_file.rs:1342 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009333 | zig_port_mut_ref | <!-- unsafe { &mut *this_ref.promise.get() } -->
| src/runtime/webcore/blob/write_file.rs:1363 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009334 | bun_heap_lifecycle | <!-- unsafe { drop(bun_core::heap::take(this)) } -->
| src/runtime/webcore/blob/write_file.rs:1370 | unsafe_block | 13 | PRESENT_WEAK | SOURCE_DIRECT | S-009335 | bun_heap_lifecycle | <!-- unsafe { drop(bun_core::heap::take(this)) } -->
| src/runtime/webcore/blob/write_file.rs:1397 | unsafe_block | 13 | PRESENT_WEAK | SOURCE_DIRECT | S-009336 | bun_heap_lifecycle | <!-- unsafe { drop(bun_core::heap::take(this)) } -->
| src/runtime/webcore/blob/write_file.rs:1409 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009337 | bun_heap_lifecycle | <!-- unsafe { bun_core::heap::take(this) } -->
| src/runtime/webcore/encoding.rs:162 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009361 | bun_ffi_helper | <!-- unsafe { bun_core::ffi::slice(input, len) } -->
| src/runtime/webcore/encoding.rs:210 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009362 | bun_ffi_helper | <!-- unsafe { bun_core::ffi::slice(input, len) } -->
| src/runtime/webcore/encoding.rs:225 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009363 | bun_ffi_helper | <!-- unsafe { bun_core::ffi::slice(input, len) } -->
| src/runtime/webcore/encoding.rs:303 | unsafe_block | 1,3,6,11,13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009364 | ANCHORED EXP-004 Vec<u8>->Vec<u16> reinterpret | <!-- unsafe { let mut input = core::mem::ManuallyDrop::new(input); Vec::fro -->
| src/runtime/webcore/encoding.rs:481 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009365 | bun_ffi_helper | <!-- unsafe { bun_core::ffi::slice(input, len) } -->
| src/runtime/webcore/encoding.rs:482 | unsafe_block | 13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009366 | raw_ptr_lifecycle/slice_from_raw | <!-- unsafe { slice::from_raw_parts_mut(to_ptr, to_len) } -->
| src/runtime/webcore/encoding.rs:533 | unsafe_block | 2 | PRESENT_STRONG | SOURCE_DIRECT | S-009367 | ptr_arith/fd_syscall | <!-- unsafe { output_ptr.add(i).write_unaligned(buf[i] as u16) } -->
| src/runtime/webcore/encoding.rs:553 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009368 | bun_ffi_helper | <!-- unsafe { bun_core::ffi::slice(input, len) } -->
| src/runtime/webcore/encoding.rs:612 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009369 | bun_ffi_helper | <!-- unsafe { bun_core::ffi::slice(input, len) } -->
| src/runtime/webcore/encoding.rs:613 | unsafe_block | 13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009370 | raw_ptr_lifecycle/slice_from_raw | <!-- unsafe { slice::from_raw_parts_mut(to, to_len) } -->
| src/runtime/webcore/encoding.rs:623 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009371 | bun_ffi_helper | <!-- unsafe { bun_core::ffi::slice(input, out) } -->
| src/runtime/webcore/encoding.rs:624 | unsafe_block | 13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009372 | raw_ptr_lifecycle/slice_from_raw | <!-- unsafe { slice::from_raw_parts_mut(to, to_len) } -->
| src/runtime/webcore/encoding.rs:635 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009373 | ptr_intrinsic | <!-- unsafe { core::ptr::copy(input_u8, to, written) } -->
| src/runtime/webcore/encoding.rs:647 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009374 | ptr_intrinsic | <!-- unsafe { core::ptr::copy(input_u8, to, fixed_len) } -->
| src/runtime/webcore/encoding.rs:658 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009375 | bun_ffi_helper | <!-- unsafe { bun_core::ffi::slice(input, len) } -->
| src/runtime/webcore/encoding.rs:659 | unsafe_block | 13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009376 | raw_ptr_lifecycle/slice_from_raw | <!-- unsafe { slice::from_raw_parts_mut(to, to_len) } -->
| src/runtime/webcore/encoding.rs:672 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009377 | bun_ffi_helper | <!-- unsafe { bun_core::ffi::slice(input, len) } -->
| src/runtime/webcore/encoding.rs:695 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009378 | bun_ffi_helper | <!-- unsafe { bun_core::ffi::slice(input, len) } -->
| src/runtime/webcore/encoding.rs:774 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009379 | bun_ffi_helper | <!-- unsafe { bun_core::ffi::slice(input, len) } -->
| src/runtime/webcore/fetch.rs:316 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009380 | zig_port_shared_ref | <!-- unsafe { &*href_raw } -->
| src/runtime/webcore/fetch.rs:1841 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009381 | other | <!-- unsafe { bun_ptr::detach_lifetime(&owned_buffer[..url_len]) } -->
| src/runtime/webcore/fetch.rs:1847 | unsafe_block | 0 | PRESENT_WEAK | SOURCE_DIRECT | S-009382 | other | <!-- unsafe { bun_ptr::detach_lifetime(&owned_buffer[url_len..]) } -->
| src/runtime/webcore/fetch.rs:1988 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009383 | zig_port_shared_ref | <!-- unsafe { &*buf_ptr } -->
| src/runtime/webcore/fetch.rs:2065 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009384 | bun_heap_lifecycle | <!-- unsafe { bun_core::heap::take(self_) } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:270 | unsafe_block | 21 | PRESENT_WEAK | SOURCE_DIRECT | S-009385 | other | <!-- unsafe { bun_ptr::callback_ctx::<FetchTasklet>(ctx) } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:285 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009386 | zig_port_mut_ref | <!-- unsafe { &mut *this } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:292 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009387 | zig_port_shared_ref | <!-- unsafe { &*this } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:345 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009388 | zig_port_mut_ref | <!-- unsafe { &mut *p } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:360 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009389 | ptr_cast | <!-- unsafe { &mut *p.as_ptr() } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:366 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009390 | ptr_intrinsic/ptr_cast/fd_syscall | <!-- unsafe { bun_ptr::ThreadSafeRefCount::<Self>::ref_(core::ptr::from_ref -->
| src/runtime/webcore/fetch/FetchTasklet.rs:371 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009391 | fd_syscall | <!-- unsafe { bun_ptr::ThreadSafeRefCount::<Self>::deref(this) } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:376 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009392 | fd_syscall | <!-- unsafe { bun_ptr::ThreadSafeRefCount::<Self>::release(this) } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:382 | unsafe_block | 0 | PRESENT_WEAK | SOURCE_DIRECT | S-009393 | other | <!-- unsafe { FetchTasklet::deinit(this) } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:397 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009394 | other | <!-- unsafe { FetchTasklet::deinit(this) } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:414 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009395 | other | <!-- unsafe { (*sink).detach_js(); ResumableFetchSink::deref_(sink); } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:423 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009396 | ptr_cast/fd_syscall | <!-- unsafe { (*buffer.as_ptr()).clear_drain_callback(); ThreadSafeStreamBu -->
| src/runtime/webcore/fetch/FetchTasklet.rs:481 | unsafe_fn | 1,13,20 | PRESENT_STRONG | SOURCE_DIRECT | S-009397 | allocator | <!-- unsafe fn deinit(this: *mut FetchTasklet) { bun_output::scoped_log!(Fe -->
| src/runtime/webcore/fetch/FetchTasklet.rs:485 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009398 | raw_method_call | <!-- unsafe { (*this).ref_count.assert_no_refs() } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:488 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009399 | bun_heap_lifecycle | <!-- unsafe { bun_core::heap::take(this) } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:522 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009400 | zig_port_mut_ref | <!-- unsafe { &mut *r } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:666 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009401 | zig_port_mut_ref | <!-- unsafe { &mut *body } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:696 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009402 | zig_port_mut_ref | <!-- unsafe { &mut *body } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:926 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009403 | bun_heap_lifecycle | <!-- unsafe { bun_core::heap::take(self_) } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:940 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009404 | bun_heap_lifecycle | <!-- unsafe { bun_core::heap::take(self_) } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:969 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009405 | other | <!-- unsafe { (*holder).task = AnyTask::from_typed( holder, if success { re -->
| src/runtime/webcore/fetch/FetchTasklet.rs:993 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009406 | ptr_intrinsic | <!-- unsafe { d2i_X509( core::ptr::null_mut(), &raw mut cert_ptr, core::ffi -->
| src/runtime/webcore/fetch/FetchTasklet.rs:1002 | unsafe_block | 20 | MISSING | SOURCE_DIRECT | S-009407 | c_alloc | <!-- unsafe { X509_free(x) } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:1004 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009408 | zig_port_mut_ref | <!-- unsafe { &mut *x509 } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:1499 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009409 | other | <!-- unsafe { HeadersRef::adopt(headers) } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:1663 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009410 | other | <!-- unsafe { &(&*buf_ptr)[N..old_url_len] } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:1664 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009411 | other | <!-- unsafe { &(&*buf_ptr)[old_url_len..] } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:1683 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009412 | zig_port_mut_ref | <!-- unsafe { &mut *fetch_tasklet_ptr } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:1704 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009413 | other | <!-- unsafe { bun_ptr::Interned::assume(fetch_tasklet.request_headers.buf.a -->
| src/runtime/webcore/fetch/FetchTasklet.rs:1707 | unsafe_block | 0 | MISSING | SOURCE_DIRECT | S-009414 | other | <!-- unsafe { bun_ptr::Interned::assume(fetch_tasklet.request_body.slice()) -->
| src/runtime/webcore/fetch/FetchTasklet.rs:1712 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009415 | other | <!-- unsafe { bun_ptr::Interned::assume(s) } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:1766 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009416 | fd_syscall | <!-- unsafe { (*buffer).set_drain_callback::<FetchTasklet>( FetchTasklet::o -->
| src/runtime/webcore/fetch/FetchTasklet.rs:2035 | unsafe_block | 1 | MISSING | SOURCE_DIRECT | S-009417 | zig_port_shared_ref | <!-- unsafe { &*async_http } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:2063 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009418 | other | <!-- unsafe { result.detach_lifetime() } -->
| src/runtime/webcore/fetch/FetchTasklet.rs:2164 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009419 | other | <!-- unsafe { (*response).get_body_value() } -->
| src/runtime/webcore/prompt.rs:320 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009493 | fd_syscall | <!-- unsafe { &mut *Output::buffered_stdin_reader() } -->
| src/runtime/webcore/s3/client.rs:321 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009557 | zig_port_mut_ref | <!-- unsafe { &mut *task_ptr } -->
| src/runtime/webcore/s3/client.rs:336 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009558 | other | <!-- unsafe { bun_ptr::detach_lifetime_ref(&*task.sign_result.url) } -->
| src/runtime/webcore/s3/client.rs:338 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009559 | other | <!-- unsafe { bun_ptr::detach_lifetime(task.headers.buf.as_slice()) } -->
| src/runtime/webcore/s3/client.rs:340 | unsafe_block | 0 | MISSING | SOURCE_DIRECT | S-009560 | other | <!-- unsafe { bun_ptr::detach_lifetime_ref(&*task.proxy_url) } -->
| src/runtime/webcore/s3/client.rs:351 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009561 | other | <!-- unsafe { vm_ref.get_mut() } -->
| src/runtime/webcore/s3/client.rs:377 | unsafe_block | 4,5 | PRESENT_STRONG | SOURCE_DIRECT | S-009562 | maybe_uninit | <!-- unsafe { task.http.assume_init_mut() } -->
| src/runtime/webcore/s3/client.rs:445 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009563 | other | <!-- unsafe { bun_jsc::event_loop::EventLoop::enter_scope(event_loop) } -->
| src/runtime/webcore/s3/client.rs:478 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009564 | other | <!-- unsafe { bun_ptr::callback_ctx::<NetworkSink>(ctx) } -->
| src/runtime/webcore/s3/client.rs:483 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009565 | zig_port_mut_ref | <!-- unsafe { &mut *task } -->
| src/runtime/webcore/s3/client.rs:484 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009566 | other | <!-- unsafe { bun_ptr::callback_ctx::<NetworkSink>(ctx) } -->
| src/runtime/webcore/s3/client.rs:534 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009567 | zig_port_mut_ref | <!-- unsafe { &mut *task_ptr } -->
| src/runtime/webcore/s3/client.rs:553 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009568 | zig_port_mut_ref | <!-- unsafe { &mut *response_stream } -->
| src/runtime/webcore/s3/client.rs:594 | unsafe_fn | 1,13,20 | PRESENT_WEAK | SOURCE_DIRECT | S-009569 | c_alloc | <!-- pub unsafe fn deref_(this: *mut Self) { // SAFETY: caller contract abo -->
| src/runtime/webcore/s3/client.rs:596 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009570 | raw_method_call | <!-- unsafe { (*this).ref_count.get() } -->
| src/runtime/webcore/s3/client.rs:597 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009571 | raw_method_call | <!-- unsafe { (*this).ref_count.set(rc) } -->
| src/runtime/webcore/s3/client.rs:600 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009572 | bun_heap_lifecycle | <!-- unsafe { bun_core::heap::take(this) } -->
| src/runtime/webcore/s3/client.rs:608 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009573 | other | <!-- unsafe { ResumableS3UploadSink::deref_(sink) } -->
| src/runtime/webcore/s3/client.rs:624 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009574 | zig_port_mut_ref | <!-- unsafe { &mut *self.task } -->
| src/runtime/webcore/s3/client.rs:641 | unsafe_block | 0 | PRESENT_WEAK | SOURCE_DIRECT | S-009575 | other | <!-- unsafe { (*sink).drain() } -->
| src/runtime/webcore/s3/client.rs:657 | unsafe_block | 1,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009576 | zig_port_self_call | <!-- unsafe { Self::deref_(s) } -->
| src/runtime/webcore/s3/client.rs:685 | unsafe_block | 1,21 | PRESENT_STRONG | SOURCE_DIRECT | S-009577 | zig_port_self_call | <!-- unsafe { Self::deref_(s) } -->
| src/runtime/webcore/s3/client.rs:701 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009578 | other | <!-- unsafe { (*sink).cancel(js_err) } -->
| src/runtime/webcore/s3/client.rs:703 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009579 | other | <!-- unsafe { ResumableS3UploadSink::deref_(sink) } -->
| src/runtime/webcore/s3/client.rs:850 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009580 | other | <!-- unsafe { bun_ptr::callback_ctx::<S3UploadStreamWrapper>(ctx) } -->
| src/runtime/webcore/s3/client.rs:857 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009581 | zig_port_mut_ref | <!-- unsafe { &mut *task } -->
| src/runtime/webcore/s3/client.rs:858 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009582 | other | <!-- unsafe { bun_ptr::callback_ctx::<S3UploadStreamWrapper>(ctx) } -->
| src/runtime/webcore/s3/client.rs:908 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009583 | zig_port_mut_ref | <!-- unsafe { &mut *task_ptr } -->
| src/runtime/webcore/s3/client.rs:924 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009584 | zig_port_mut_ref | <!-- unsafe { &mut *ctx_ptr } -->
| src/runtime/webcore/s3/client.rs:1056 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009585 | zig_port_mut_ref | <!-- unsafe { &mut *task_ptr } -->
| src/runtime/webcore/s3/client.rs:1061 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009586 | other | <!-- unsafe { bun_ptr::detach_lifetime_ref(&*task.sign_result.url) } -->
| src/runtime/webcore/s3/client.rs:1063 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009587 | other | <!-- unsafe { bun_ptr::detach_lifetime(task.headers.buf.as_slice()) } -->
| src/runtime/webcore/s3/client.rs:1065 | unsafe_block | 0 | MISSING | SOURCE_DIRECT | S-009588 | other | <!-- unsafe { bun_ptr::detach_lifetime_ref(&*task.proxy_url) } -->
| src/runtime/webcore/s3/client.rs:1101 | unsafe_block | 4,5 | PRESENT_STRONG | SOURCE_DIRECT | S-009589 | maybe_uninit | <!-- unsafe { task.http.assume_init_mut() } -->
| src/runtime/webcore/s3/client.rs:1143 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009590 | bun_heap_lifecycle | <!-- unsafe { bun_core::heap::take(s) } -->
| src/runtime/webcore/s3/client.rs:1195 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009591 | ptr_cast | <!-- unsafe { &mut *ctx.unwrap().cast::<Self>() } -->
| src/runtime/webcore/s3/client.rs:1211 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009592 | other | <!-- unsafe { bun_ptr::callback_ctx::<Self>(opaque_self) } -->
| src/runtime/webcore/s3/client.rs:1237 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009593 | fd_syscall | <!-- unsafe { &mut *reader } -->
| src/runtime/webcore/s3/download_stream.rs:183 | unsafe_block | 1 | MISSING | SOURCE_DIRECT | S-009594 | zig_port_mut_ref | <!-- unsafe { &mut *this } -->
| src/runtime/webcore/s3/download_stream.rs:252 | unsafe_block | 10 | MISSING | SOURCE_DIRECT | S-009595 | ptr_intrinsic/ptr_cast/fd_syscall | <!-- unsafe { core::ptr::write(self.http.as_mut_ptr(), core::ptr::read(asyn -->
| src/runtime/webcore/s3/download_stream.rs:333 | unsafe_block | 1 | MISSING | SOURCE_DIRECT | S-009596 | zig_port_mut_ref | <!-- unsafe { &mut *this } -->
| src/runtime/webcore/s3/download_stream.rs:335 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009597 | zig_port_mut_ref | <!-- unsafe { &mut *async_http } -->
| src/runtime/webcore/s3/download_stream.rs:363 | unsafe_block | 4,5 | MISSING | SOURCE_DIRECT | S-009598 | maybe_uninit | <!-- unsafe { self.http.assume_init_mut() } -->
| src/runtime/webcore/s3/error_jsc.rs:16 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009599 | other | <!-- unsafe { core::str::from_utf8_unchecked(bytes) } -->
| src/runtime/webcore/s3/multipart.rs:197 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009600 | other | <!-- unsafe { <Self as bun_ptr::CellRefCounted>::deref(this) } -->
| src/runtime/webcore/s3/multipart.rs:241 | unsafe_block | 6,13,15,20 | PRESENT_STRONG | SOURCE_DIRECT | S-009601 | raw_ptr_lifecycle/ptr_cast/slice_from_raw | <!-- unsafe { let ptr = (*self.data).as_ptr().cast_mut(); drop(Vec::from_ra -->
| src/runtime/webcore/s3/multipart.rs:257 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009602 | zig_port_shared_ref | <!-- unsafe { &*self.data } -->
| src/runtime/webcore/s3/multipart.rs:262 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009603 | other | <!-- unsafe { bun_ptr::callback_ctx::<Self>(this) } -->
| src/runtime/webcore/s3/multipart.rs:267 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009604 | other | <!-- unsafe { ctx_ref.get_mut() } -->
| src/runtime/webcore/s3/multipart.rs:305 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009605 | other | <!-- unsafe { (*ctx_ptr).fail(err) } -->
| src/runtime/webcore/s3/multipart.rs:330 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009606 | other | <!-- unsafe { (*ctx_ptr).drain_enqueued_parts(sent as u64) } -->
| src/runtime/webcore/s3/multipart.rs:342 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009607 | other | <!-- unsafe { ctx_ref.get_mut() } -->
| src/runtime/webcore/s3/multipart.rs:423 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009608 | other | <!-- unsafe { bun_ptr::callback_ctx::<Self>(this) } -->
| src/runtime/webcore/s3/multipart.rs:493 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009609 | raw_ptr_lifecycle/ptr_intrinsic | <!-- unsafe { bun_ptr::BackRef::from_raw(std::ptr::from_mut::<Self>(self))  -->
| src/runtime/webcore/s3/multipart.rs:612 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009610 | raw_method_call | <!-- unsafe { (*this).rollback_multi_part_request()? } -->
| src/runtime/webcore/s3/multipart.rs:667 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009611 | other | <!-- unsafe { bun_ptr::ScopedRef::<Self>::adopt(this) } -->
| src/runtime/webcore/s3/multipart.rs:669 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009612 | zig_port_mut_ref | <!-- unsafe { &mut *this } -->
| src/runtime/webcore/s3/multipart.rs:732 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009613 | zig_port_mut_ref | <!-- unsafe { &mut *this } -->
| src/runtime/webcore/s3/multipart.rs:771 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009614 | zig_port_mut_ref | <!-- unsafe { &mut *this } -->
| src/runtime/webcore/s3/multipart.rs:893 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009615 | other | <!-- unsafe { (*part).start()? } -->
| src/runtime/webcore/s3/multipart.rs:938 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009616 | zig_port_shared_ref | <!-- unsafe { &*slice_ptr } -->
| src/runtime/webcore/s3/multipart.rs:972 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009617 | zig_port_shared_ref | <!-- unsafe { &*slice_ptr } -->
| src/runtime/webcore/s3/multipart.rs:1082 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009618 | ptr_intrinsic | <!-- unsafe { bun_ptr::ScopedRef::new(std::ptr::from_mut::<Self>(self)) } -->
| src/runtime/webcore/s3/simple_request.rs:335 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009619 | bun_heap_lifecycle | <!-- unsafe { bun_core::heap::take(this) } -->
| src/runtime/webcore/s3/simple_request.rs:437 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009620 | zig_port_mut_ref | <!-- unsafe { &mut *this } -->
| src/runtime/webcore/s3/simple_request.rs:441 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009621 | other | <!-- unsafe { result.detach_lifetime() } -->
| src/runtime/webcore/s3/simple_request.rs:452 | unsafe_block | 10 | PRESENT_STRONG | SOURCE_DIRECT | S-009622 | ptr_intrinsic/ptr_cast/fd_syscall | <!-- unsafe { core::ptr::write(this.http.as_mut_ptr(), core::ptr::read(asyn -->
| src/runtime/webcore/s3/simple_request.rs:494 | unsafe_block | 4,5 | PRESENT_STRONG | SOURCE_DIRECT | S-009623 | maybe_uninit | <!-- unsafe { self.http.assume_init_mut() } -->
| src/runtime/webcore/s3/simple_request.rs:615 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009624 | zig_port_mut_ref | <!-- unsafe { &mut *task_ptr } -->
| src/runtime/webcore/s3/simple_request.rs:631 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009625 | other | <!-- unsafe { bun_ptr::detach_lifetime_ref(&*task.sign_result.url) } -->
| src/runtime/webcore/s3/simple_request.rs:633 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009626 | other | <!-- unsafe { bun_ptr::detach_lifetime(task.headers.buf.as_slice()) } -->
| src/runtime/webcore/s3/simple_request.rs:641 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009627 | other | <!-- unsafe { bun_ptr::detach_lifetime(options.body) } -->
| src/runtime/webcore/s3/simple_request.rs:643 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009628 | other | <!-- unsafe { bun_ptr::detach_lifetime_ref(&*task.proxy_url) } -->
| src/runtime/webcore/s3/simple_request.rs:675 | unsafe_block | 4,5 | PRESENT_STRONG | SOURCE_DIRECT | S-009629 | maybe_uninit | <!-- unsafe { task.http.assume_init_mut() } -->
| src/runtime/webcore/streams.rs:505 | unsafe_block | 21 | PRESENT_WEAK | SOURCE_DIRECT | S-009652 | other | <!-- unsafe { bun_ptr::callback_ctx::<C>(ctx_) } -->
| src/runtime/webcore/streams.rs:608 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009653 | zig_port_mut_ref | <!-- unsafe { &mut *pending } -->
| src/runtime/webcore/streams.rs:703 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009654 | bun_heap_lifecycle | <!-- unsafe { bun_core::heap::take(this) } -->
| src/runtime/webcore/streams.rs:747 | unsafe_block | 21 | PRESENT_WEAK | SOURCE_DIRECT | S-009655 | other | <!-- unsafe { bun_ptr::callback_ctx::<C>(ctx_) } -->
| src/runtime/webcore/streams.rs:911 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009656 | other | <!-- unsafe { &mut **pending } -->
| src/runtime/webcore/streams.rs:983 | unsafe_block | 0 | PRESENT_WEAK | SOURCE_DIRECT | S-009657 | ptr_intrinsic | <!-- unsafe { Self::init_with_type(std::ptr::from_mut::<T>(handler)) } -->
| src/runtime/webcore/streams.rs:1045 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009658 | other | <!-- unsafe { bun_ptr::callback_ctx::<W>(this) } -->
| src/runtime/webcore/streams.rs:1053 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009659 | other | <!-- unsafe { bun_ptr::callback_ctx::<W>(this) } -->
| src/runtime/webcore/streams.rs:1057 | unsafe_block | 21 | PRESENT_STRONG | SOURCE_DIRECT | S-009660 | other | <!-- unsafe { bun_ptr::callback_ctx::<W>(this) } -->
| src/runtime/webcore/streams.rs:1324 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009661 | ptr_intrinsic | <!-- unsafe { (*this).on_writable(off, core::ptr::null_mut()) } -->
| src/runtime/webcore/streams.rs:1409 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009662 | ptr_intrinsic | <!-- unsafe { (*this).on_writable(off, core::ptr::null_mut()) } -->
| src/runtime/webcore/streams.rs:1536 | unsafe_block | 4,5 | PRESENT_STRONG | SOURCE_DIRECT | S-009663 | ptr_cast/maybe_uninit | <!-- unsafe { core::mem::replace( (*pooled_node.as_ptr()).data.assume_init_ -->
| src/runtime/webcore/streams.rs:1922 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009664 | bun_heap_lifecycle | <!-- unsafe { bun_core::heap::take(this) } -->
| src/runtime/webcore/streams.rs:1967 | unsafe_block | 5 | PRESENT_WEAK | SOURCE_DIRECT | S-009665 | ptr_cast/maybe_uninit | <!-- unsafe { (*pooled.as_ptr()).data = core::mem::MaybeUninit::new(core::m -->
| src/runtime/webcore/streams.rs:2015 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009666 | raw_method_call | <!-- unsafe { (*this).wrote_at_start_of_flush = (*this).wrote } -->
| src/runtime/webcore/streams.rs:2152 | unsafe_block | 0 | PRESENT_STRONG | SOURCE_DIRECT | S-009667 | other | <!-- unsafe { p.get_mut() } -->
| src/runtime/webcore/streams.rs:2271 | unsafe_block | 13 | PRESENT_STRONG | SOURCE_DIRECT | S-009668 | bun_heap_lifecycle | <!-- unsafe { bun_core::heap::take(this) } -->
| src/runtime/webcore/streams.rs:2589 | unsafe_block | 2,6,13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009669 | raw_ptr_lifecycle/slice_from_raw | <!-- unsafe { Vec::from_raw_parts(slice_ptr, len as usize, len as usize) } -->
| src/runtime/webcore/streams.rs:2595 | unsafe_block | 2,6,13,15 | PRESENT_STRONG | SOURCE_DIRECT | S-009670 | raw_ptr_lifecycle/slice_from_raw | <!-- unsafe { Vec::from_raw_parts(slice_ptr, len as usize, len as usize) } -->
| src/runtime/webcore/wasm_streaming.rs:39 | unsafe_block | 1 | PRESENT_STRONG | SOURCE_DIRECT | S-009684 | zig_port_mut_ref | <!-- unsafe { &mut *r } -->
| src/runtime/webcore/wasm_streaming.rs:163 | unsafe_block | 1 | PRESENT_WEAK | SOURCE_DIRECT | S-009685 | zig_port_shared_ref | <!-- unsafe { &*this } -->
