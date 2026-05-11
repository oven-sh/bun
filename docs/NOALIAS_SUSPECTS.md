# noalias SUSPECT sites (73 — UB, not currently miscompiled)

From noalias-hunt @ wa4pe2sat. These survived 2-vote triage but ASM showed NOT_CACHED in current codegen — typically because a self-derived ptr incidentally escapes nearby, or post-call read goes through a non-inlined callee. One inlining-heuristic change away from miscompiling.

Systemic fix: R-2 Phase 2 (per-type &self+Cell). Phase 0 black_box covers the 23 PROVEN.

| File:Line | Method |
|---|---|
| src/event_loop/MiniEventLoop.rs:366 | tick_once |
| src/event_loop/MiniEventLoop.rs:403 | tick |
| src/io/PipeReader.rs:595 | read_blocking_pipe |
| src/io/PipeReader.rs:765 | read_with_fn |
| src/io/PipeReader.rs:1203 | _on_read_chunk |
| src/io/PipeWriter.rs:399 | _on_write |
| src/io/PipeWriter.rs:695 | _on_error |
| src/io/PipeWriter.rs:754 | register_poll |
| src/io/PipeWriter.rs:1448 | on_write_complete |
| src/io/PipeWriter.rs:1892 | on_write_complete |
| src/jsc/VirtualMachine.rs:1273 | uncaught_exception |
| src/jsc/VirtualMachine.rs:2135 | reload_entry_point |
| src/jsc/VirtualMachine.rs:3377 | wait_for |
| src/jsc/event_loop.rs:304 | exit |
| src/jsc/event_loop.rs:330 | exit_maybe_drain_microtasks |
| src/jsc/event_loop.rs:425 | run_callback |
| src/jsc/event_loop.rs:443 | run_callback_with_result |
| src/jsc/event_loop.rs:710 | tick_immediate_tasks |
| src/jsc/ipc.rs:143 | flush |
| src/jsc/ipc.rs:934 | close_socket |
| src/jsc/ipc.rs:1283 | _on_write_complete |
| src/jsc/rare_data.rs:745 | close_all_watchers_for_isolation |
| src/runtime/api/bun/Terminal.rs:1659 | on_reader_done |
| src/runtime/api/bun/Terminal.rs:1676 | on_reader_error |
| src/runtime/api/bun/h2_frame_parser.rs:1480 | Stream::flush_queue |
| src/runtime/api/bun/h2_frame_parser.rs:1675 | Stream::queue_frame |
| src/runtime/api/bun/h2_frame_parser.rs:2120 | send_go_away |
| src/runtime/api/bun/h2_frame_parser.rs:2460 | flush |
| src/runtime/api/bun/h2_frame_parser.rs:2512 | _write |
| src/runtime/api/bun/h2_frame_parser.rs:2896 | handle_data_frame |
| src/runtime/api/bun/h2_frame_parser.rs:4309 | send_data |
| src/runtime/api/bun/subprocess.rs:944 | on_process_exit |
| src/runtime/api/html_rewriter.rs:612 | <HTMLRewriterLoader as SinkHandler>::end |
| src/runtime/dns_jsc/dns.rs:3527 | check_timeouts |
| src/runtime/dns_jsc/dns.rs:4163 | on_dns_poll |
| src/runtime/node/node_zlib_binding.rs:418 | CompressionStream::run_from_js_thread |
| src/runtime/node/node_zlib_binding.rs:476 | CompressionStream::write_sync |
| src/runtime/node/node_zlib_binding.rs:681 | CompressionStream::emit_error |
| src/runtime/node/zlib/NativeZlib.rs:179 | NativeZlib::params |
| src/runtime/server/NodeHTTPResponse.rs:779 | handle_abort_or_timeout |
| src/runtime/server/NodeHTTPResponse.rs:838 | on_abort |
| src/runtime/server/NodeHTTPResponse.rs:848 | on_timeout |
| src/runtime/server/NodeHTTPResponse.rs:1123 | on_data_or_aborted |
| src/runtime/server/NodeHTTPResponse.rs:1167 | on_data |
| src/runtime/server/NodeHTTPResponse.rs:1178 | on_drain_corked |
| src/runtime/server/RequestContext.rs:3033 | run_error_handler_with_status_code_dont_check_responded |
| src/runtime/server/mod.rs:1446 | stop |
| src/runtime/socket/WindowsNamedPipe.rs:338 | on_read_error |
| src/runtime/socket/WindowsNamedPipe.rs:393 | on_close |
| src/runtime/socket/WindowsNamedPipe.rs:424 | call_write_or_end |
| src/runtime/socket/WindowsNamedPipe.rs:555 | on_internal_receive_data |
| src/runtime/socket/WindowsNamedPipe.rs:653 | on_connect |
| src/runtime/socket/WindowsNamedPipe.rs:1102 | encode_and_write |
| src/runtime/socket/WindowsNamedPipe.rs:1144 | close |
| src/runtime/socket/WindowsNamedPipe.rs:1171 | shutdown |
| src/runtime/socket/socket_body.rs:2282 | internal_flush |
| src/runtime/webcore/FileReader.rs:914 | on_reader_done |
| src/runtime/webcore/s3/multipart.rs:566 | fail |
| src/runtime/webcore/streams.rs:1852 | abort |
| src/runtime/webcore/streams.rs:1980 | flush_promise |
| src/sql_jsc/mysql/JSMySQLConnection.rs:373 | close |
| src/sql_jsc/mysql/JSMySQLConnection.rs:838 | fail_with_js_value |
| src/sql_jsc/mysql/JSMySQLQuery.rs:263 | resolve |
| src/sql_jsc/mysql/JSMySQLQuery.rs:364 | reject_with_js_value |
| src/sql_jsc/postgres/PostgresSQLConnection.rs:702 | fail_with_js_value |
| src/sql_jsc/postgres/PostgresSQLConnection.rs:1459 | clean_up_requests |
| src/sql_jsc/postgres/PostgresSQLConnection.rs:1745 | advance |
| src/sql_jsc/postgres/PostgresSQLQuery.rs:185 | on_js_error |
| src/sql_jsc/postgres/PostgresSQLQuery.rs:231 | on_result |
| src/uws/lib.rs:497 | shutdown |
| src/uws/lib.rs:739 | update_handshake_state |
| src/uws/lib.rs:826 | handle_reading |
| src/uws/lib.rs:921 | handle_writing |
