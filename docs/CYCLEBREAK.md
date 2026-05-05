# CYCLEBREAK — Phase B-0 spec

Breaking the 89-crate dependency cycle so `cargo` can build tier-by-tier.
Agents read **only their crate's section** below. Edit only `src/<your-crate>/`.
NEVER run git. NEVER edit another crate.

## Summary

| | |
|---|---|
| edges audited | 174 (146 back + 28 same-tier mutual) |
| symbols classified | 477 |
| DELETE (applied) | 159 → 99 edits, 10 edges gone |
| FORWARD_DECL | 7 |
| TYPE_ONLY | 50 |
| MOVE_DOWN | 144 |
| GENUINE | 117 |
| back-edges remaining | **136** |

GENUINE breaks into: ~40 dispatch (vtable/hoisted-match per §Dispatch), ~8
debug-hooks (AtomicPtr registration), ~35 tier-6-internal (collapse), ~34
misc (case-by-case in §move-out).

## Tier-6 collapse

`bake`, `shell`, `test_runner`, `cli`, `napi` become **modules of
`bun_runtime`**, not separate crates. Mechanically: their `src/<x>/` dirs move
under `src/runtime/<x>/`; `bun_bake::` → `crate::bake::`, etc. `bun_jsc`
remains separate (it's the FFI layer; `runtime` depends on it, not vice versa
— `jsc→runtime` GENUINE refs become `runtime→jsc` callbacks via vtable).

Edges this eliminates outright (become intra-crate):
- `bake→jsc`: bun_jsc::Strong, bun_jsc::ConcurrentTask, bun_jsc::PromiseUnwrap, bun_jsc::PromiseResult, bun_jsc::node, bun_jsc::MarkedArgumentBuffer, bun_jsc::JsClass, bun_jsc::host_fn, bun_jsc::JSObject, bun_jsc::JSFunction
- `bake→runtime`: bun_runtime::api::server::StaticRoute, bun_runtime::api::AnyServer, bun_runtime::api::HTMLBundle, bun_runtime::api::SavedRequest, bun_runtime::api::js_bundler::Plugin, bun_runtime::webcore::Blob, bun_runtime::webcore::blob::AnyBlob, bun_runtime::webcore::Request, bun_runtime::webcore::Response
- `bundler→bake`: bun_bake::DevServer
- `bundler→jsc`: bun_jsc::VirtualMachine, bun_jsc::initialize, bun_jsc::CachedBytecode, bun_jsc::EventLoopHandle, bun_jsc::hot_reloader
- `cli→jsc`: bun_jsc::jest, bun_jsc::Jest, bun_jsc::VirtualMachine, bun_jsc::JsResult, bun_jsc::host_fn
- `cli→shell`: bun_shell::Interpreter
- `http_jsc→jsc`: bun_jsc::VirtualMachine
- `http_jsc→runtime`: bun_runtime::webcore::Blob
- `http→runtime`: bun_runtime::webcore::FetchHeaders, bun_runtime::webcore::blob::Any
- `install→cli`: bun_cli::BuildCommand
- `jsc→runtime`: bun_runtime::api, bun_runtime::webcore, bun_runtime::node, bun_runtime::s3
- `jsc→test_runner`: bun_test_runner::pretty_format
- `runtime→shell`: bun_shell::ShellSubprocess, bun_shell::ParsedShellScript, bun_shell::Interpreter
- `runtime→test_runner`: bun_test_runner::jest::Jest::call
- `s3_signing→jsc`: bun_jsc::VirtualMachine

Plus all `*_jsc` ↔ `runtime`/`bake`/`shell`/`cli` same-tier pairs.

## Hot dispatch list

These five `union(enum)` sites are per-tick hot. Use the **hoisted-match**
pattern (PORTING.md §Dispatch): low tier stores `(tag: u8, ptr: *mut ())`,
`bun_runtime` owns the `match`. Tag constants live in the low tier as bare
`pub const TAG_X: u8`; `runtime` defines what each maps to.

| low-tier owner | Zig type | runtime dispatch fn | tag module |
|---|---|---|---|
| `bun_event_loop::Task` | `Task = union(Tag)` | `runtime::dispatch::run_task(Task)` | `event_loop::task_tag` (~70 variants) |
| `bun_event_loop::ConcurrentTask` | `ConcurrentTask` | `runtime::dispatch::run_concurrent(..)` | shares `task_tag` |
| `bun_aio::FilePoll` | `Owner = TaggedPointerUnion(.{...})` | `runtime::dispatch::on_poll(tag, ptr, ev)` | `aio::poll_tag` (~13) |
| `bun_event_loop::EventLoopTimer` | `Tag = enum` | `runtime::dispatch::fire_timer(tag, ptr)` | `event_loop::timer_tag` (~20) |
| `bun_io::Source` | `Source = union(enum)` | `runtime::dispatch::on_source(tag, ptr, ev)` | `io::source_tag` (~6) |
| `bun_threading::WorkPoolTask` | `WorkPool.Task` | `runtime::dispatch::run_work(tag, ptr)` | `threading::work_tag` (~8) |

All other cross-tier `union(enum)` → **manual vtable** (cold path).

## Debug-hook registration (pattern 3)

Low tier defines `static HOOK: AtomicPtr<()> = AtomicPtr::new(null_mut())` and
calls through it (no-op if null). `bun_runtime::init()` writes the fn-ptr.

| low-tier hook | high-tier provider |
|---|---|
| `bun_safety::DUMP_STACK: AtomicPtr<fn(&mut dyn Write)>` | `crash_handler::dump_stack_trace` |
| `bun_ptr::DUMP_STACK` | same |
| `bun_sys::DUMP_STACK` | same |
| `bun_safety::ALLOC_HAS_PTR: AtomicPtr<fn(*const ()) -> bool>` | `bundler::allocator_has_pointer` |
| `bun_core::RESET_SEGV: AtomicPtr<fn()>` | `crash_handler::reset_segfault_handler` |
| `bun_core::OUTPUT_SINK: AtomicPtr<dyn Write>` | `sys::stderr_writer()` (resolves bun_core→sys) |
| `bun_crash_handler::DUMP_BUNDLER: AtomicPtr<fn(&mut dyn Write)>` | `bundler::dump_state` |

---

## Per-source-crate move-out tasks

One agent per crate below. Read your section, apply the changes inside
`src/<crate>/` only. For each symbol:
- **MOVE_DOWN** `sym`→`target`: delete the `use bun_X::sym`; either (a) the
  symbol now lives in `target` (re-import from there if `target` ≤ your tier),
  or (b) if `target` is your own crate, the move-in pass will add it — leave a
  `// TODO(b0): sym arrives from move-in` placeholder.
- **TYPE_ONLY** `sym`→`target`: same as MOVE_DOWN but only the type def moves.
- **FORWARD_DECL**: replace with `*mut ()` / `*const ()` + `// SAFETY: erased <Type>`.
- **GENUINE**: apply §Dispatch (vtable or hoisted-match per the hot list) or
  §Debug-hook above. If neither fits, leave `// TODO(b0-genuine): <sym>` and
  return it in your blocked list.

### `bun_alloc` (T0, 14 syms)
- **GENUINE** `bun_runtime::webcore::blob::store::Bytes`, `bun_ptr::IntrusiveArc`
- **MOVE_DOWN** `bun_str::String`→`alloc`, `bun_sys::page_size`→`alloc`, `VirtualMachine::is_smol_mode`→`core`, `bun_threading::Mutex`→`lock`, `bun_threading::Guarded`→`lock`, `bun_core::declare_scope`→`output`, `bun_core::scoped_log`→`output`, `bun_core::output`→`output`, `bun_core::Output`→`output`, `bun_core::out_of_memory`→`alloc`, `bun_safety::ThreadLock`→`core`
- **TYPE_ONLY** `bun_paths::PathBuffer`→`core`

### `bun_core` (T0, 28 syms)
- **GENUINE** `bun_sys::File`, `bun_sys::QuietWrite`, `bun_sys::file`, `bun_sys::Error`, `bun_sys::make_path`, `bun_sys::create_file`, `bun_sys::deprecated`, `bun_crash_handler::reset_segfault_handler`
- **MOVE_DOWN** `bun_str::ZStr`→`core`, `bun_str::zstr`→`core`, `bun_str::strings`→`core`, `bun_sys::windows`→`windows_sys`, `bun_sys::Fd`→`core`, `bun_sys::fd`→`core`, `bun_sys::coreutils_error_map`→`core`, `bun_analytics::features`→`core`, `bun_crash_handler::is_panicking`→`core`, `bun_crash_handler::sleep_forever_if_another_thread_is_crashing`→`core`, `bun_js_parser::js_printer`→`core`, `bun_js_parser::js_lexer`→`core`, `bun_threading::Mutex`→`core`, `bun_io::Writer`→`core`, `bun_paths::SEP`→`core`, `bun_paths::PathBuffer`→`core`
- **TYPE_ONLY** `bun_semver::Version`→`core`, `bun_sys::Winsize`→`core`, `bun_sys::CreateFileOptions`→`stays`, `bun_paths::OSPathSlice`→`core`

### `errno` (T0, 2 syms)
- **MOVE_DOWN** `bun_sys::posix`→`errno`, `bun_sys::windows`→`windows_sys`

### `libarchive_sys` (T0, 5 syms)
- **GENUINE** `bun_sys::Result`, `bun_sys::set_file_offset`, `bun_sys::ftruncate`, `bun_sys::FileKind`, `bun_sys::kind_from_mode`

### `ptr` (T0, 2 syms)
- **GENUINE** `bun_crash_handler::dump_stack_trace`
- **MOVE_DOWN** `bun_crash_handler::StoredTrace`→`debug`

### `safety` (T0, 7 syms)
- **GENUINE** `bun_crash_handler::dump_stack_trace`, `bun_bundler::allocator_has_pointer`, `bun_string::String`
- **MOVE_DOWN** `bun_threading::ThreadId`→`safety`, `bun_crash_handler::StoredTrace`→`debug`
- **TYPE_ONLY** `bun_crash_handler::DumpOptions`→`debug`, `bun_crash_handler::DumpStackTraceOptions`→`debug`

### `uws_sys` (T0, 5 syms)
- **FORWARD_DECL** `bun_threading::Mutex`
- **MOVE_DOWN** `bun_str::ZStr`→`core`
- **TYPE_ONLY** `bun_sys::Fd`→`core`, `bun_uws::SocketAddress`→`uws_sys`, `bun_http::Method`→`http_types`

### `windows_sys` (T0, 1 syms)
- **TYPE_ONLY** `bun_sys::windows`→`windows_sys`

### `collections` (T1, 11 syms)
- **GENUINE** `bun_css::Parser`, `bun_css::Result`, `bun_css::generic`, `bun_css::Printer`, `bun_css::PrintErr`, `bun_css::ToCss`, `bun_css::to_css`, `bun_str::strings`→`Move`, `bun_str::String`→`Move`
- **MOVE_DOWN** `bun_crash_handler::StoredTrace`→`core`, `bun_crash_handler::dump_stack_trace`→`core`

### `paths` (T1, 7 syms)
- **GENUINE** `bun_sys::Fd`, `bun_sys::getcwd`
- **MOVE_DOWN** `bun_resolver::fs`→`paths`, `bun_string::ZStr`→`core`, `bun_string::WStr`→`core`, `bun_string::strings`→`string`, `bun_sys::windows::long_path_prefix_for`→`paths`

### `string` (T1, 8 syms)
- **GENUINE** `bun_js_parser::E`
- **MOVE_DOWN** `bun_js_parser::js_lexer`→`string`, `bun_js_parser::lexer`→`string`, `bun_js_parser::lexer_tables`→`string`, `bun_js_parser::printer`→`string`, `bun_jsc::webcore::encoding`→`string`, `bun_sys::windows`→`paths`
- **TYPE_ONLY** `bun_jsc::node::Encoding`→`string`

### `sys` (T1, 6 syms)
- **GENUINE** `bun_crash_handler::dump_current_stack_trace`→`core`, `bun_logger::Source`
- **MOVE_DOWN** `bun_runtime::node`→`sys`, `generate_header`→`sys`
- **TYPE_ONLY** `bun_crash_handler::DumpOptions`→`core`, `bun_jsc::SystemError`→`sys`

### `boringssl` (T2, 1 syms)
- **MOVE_DOWN** `bun_runtime::api::bun::x509::is_safe_alt_name`→`boringssl`

### `csrf` (T2, 1 syms)
- **TYPE_ONLY** `bun_jsc::api::bun::crypto::evp::Algorithm`→`sha_hmac`

### `dotenv` (T2, 3 syms)
- **GENUINE** `bun_bundler::defines::DefineData`, `bun_bundler::defines::DefineDataInit`
- **MOVE_DOWN** `bun_resolver::fs`→`fs`

### `glob` (T2, 1 syms)
- **MOVE_DOWN** `bun_runtime::node::dir_iterator`→`sys`

### `io` (T2, 14 syms)
- **GENUINE** `bun_jsc::Subprocess`, `bun_jsc::VirtualMachine`, `bun_jsc::EventLoopHandle`, `bun_aio::FilePoll`, `bun_aio::FilePollFlags`, `bun_aio::Pollable`, `bun_aio::PollMode`, `bun_aio::PollFlag`, `bun_runtime::webcore::blob::read_file::ReadFile`, `bun_runtime::webcore::blob::write_file::WriteFile`
- **MOVE_DOWN** `bun_aio::Waker`→`io`, `bun_aio::Closer`→`io`
- **TYPE_ONLY** `bun_runtime::webcore::PathOrFileDescriptor`→`io`, `bun_uws::Loop`→`uws_sys`

### `logger` (T2, 4 syms)
- **MOVE_DOWN** `fs::Path`→`paths`
- **TYPE_ONLY** `bun_js_parser::Index`→`logger`, `bun_options_types::ImportKind`→`logger`, `fs::PathContentsPair`→`paths`

### `picohttp` (T2, 1 syms)
- **MOVE_DOWN** `printer::write_json_string`→`string`

### `semver` (T2, 3 syms)
- **MOVE_DOWN** `bun_install_types::sliced_string::SlicedString`→`semver`, `bun_install_types::external_string::ExternalString`→`semver`, `bun_install_types::semver_string::String`→`semver`

### `sha_hmac` (T2, 1 syms)
- **MOVE_DOWN** `api (bun_jsc::api::bun::crypto::evp::Algorithm)`→`sha_hmac`

### `threading` (T2, 1 syms)
- **MOVE_DOWN** `wtf::release_fast_malloc_free_memory_for_this_thread`→`alloc`

### `url` (T2, 2 syms)
- **MOVE_DOWN** `bun_jsc::URL`→`url`
- **TYPE_ONLY** `bun_router::param::List`→`url`

### `watcher` (T2, 2 syms)
- **FORWARD_DECL** `bun_resolver::package_json::PackageJSON`
- **TYPE_ONLY** `bun_bundler::options::Loader`→`options_types`

### `aio` (T3, 7 syms)
- **GENUINE** `bun_jsc::EventLoopHandle`, `bun_shell::Interpreter`, `bun_shell::ShellSubprocess`, `bun_runtime::webcore`, `bun_runtime::api`, `bun_install::SecurityScanSubprocess`→`trait`
- **MOVE_DOWN** `bun_jsc::mark_binding`→`core`

### `analytics` (T3, 1 syms)
- **TYPE_ONLY** `module_loader::HardcodedModule`→`options_types`

### `crash_handler` (T3, 5 syms)
- **GENUINE** `bun_bundler::LinkerContext`, `bun_bundler::Chunk`, `bun_bundler::PartRange`
- **MOVE_DOWN** `bun_sourcemap::VLQ`→`base64`, `bun_cli::Cli`→`crash_handler`

### `event_loop` (T3, 9 syms)
- **GENUINE** `bun_jsc::VirtualMachine`, `bun_runtime::api`, `bun_runtime::node`, `bun_runtime::jest`, `bun_runtime::webcore`, `bun_bake::DevServer`, `bun_bake::dev_server::SourceMapStore`
- **MOVE_DOWN** `bun_jsc::mark_binding`→`core`
- **TYPE_ONLY** `bun_jsc::Task`→`event_loop`

### `http_types` (T3, 1 syms)
- **MOVE_DOWN** `bun_http::Headers`→`http_types`

### `ini` (T3, 7 syms)
- **MOVE_DOWN** `e`→`js_ast`, `E`→`js_ast`, `Expr`→`js_ast`, `ExprData`→`js_ast`, `e::object::Rope`→`js_ast`, `bun_install::PnpmMatcher`→`install_types`, `bun_install::npm::Registry::DEFAULT_URL`→`install_types`

### `options_types` (T3, 7 syms)
- **FORWARD_DECL** `bun_jsc::RegularExpression`
- **GENUINE** `bun_http::HTTPThread`, `bun_http::AsyncHTTP`
- **MOVE_DOWN** `PackageManager::fetch_cache_directory_path`→`fs`
- **TYPE_ONLY** `coverage::Fraction`→`options_types`, `bun_bundler::options::Loader`→`options_types`, `bun_js_parser::Index`→`options_types`

### `patch` (T3, 2 syms)
- **GENUINE** `bun_jsc::AnyEventLoop`, `bun_jsc::EventLoopHandle`

### `css` (T4, 7 syms)
- **MOVE_DOWN** `bun_bundler::cheap_prefix_normalizer`→`string`, `bun_js_parser::ast`→`js_ast`, `bun_js_parser::Symbol`→`js_ast`, `bun_js_parser::symbol`→`js_ast`
- **TYPE_ONLY** `bun_bundler::Ref`→`js_parser`, `bun_bundler::options::Target`→`options_types`, `bun_bundler::v2`→`js_parser`

### `interchange` (T4, 7 syms)
- **GENUINE** `bun_js_parser::js_lexer`→`js_lexer`
- **MOVE_DOWN** `wtf::parse_double`→`string`, `bun_js_parser::ast`→`js_ast`, `bun_js_parser::lexer`→`js_ident`, `bun_js_parser::ExprNodeList`→`js_ast`, `bun_js_parser::js_ast`→`js_ast`
- **TYPE_ONLY** `bun_js_parser::js_printer`→`js_ast`

### `js_parser` (T4, 10 syms)
- **MOVE_DOWN** `bun_bundler::defines`→`js_parser`, `bun_jsc::math`→`js_parser`, `bun_jsc::URL`→`url`, `bun_jsc::RuntimeTranspilerCache`→`js_parser`, `bun_resolver::fs`→`paths`, `bun_js_printer::quote_for_json`→`string`, `bun_js_printer::renamer`→`js_parser`
- **TYPE_ONLY** `bun_bundler::options`→`options_types`, `bun_bake::Framework`→`options_types`, `bun_js_printer::Options::Indentation`→`js_parser`

### `js_printer` (T4, 4 syms)
- **GENUINE** `bun_jsc::RuntimeTranspilerCache`
- **MOVE_DOWN** `bun_bundler::analyze_transpiled_module`→`js_printer`
- **TYPE_ONLY** `bun_bundler::options`→`options_types`, `bun_bundler::MangledProps`→`js_printer`

### `router` (T4, 3 syms)
- **GENUINE** `bun_resolver::dir_info::DirInfo`
- **MOVE_DOWN** `bun_resolver::fs`→`fs`, `options::RouteConfig`→`router`

### `shell_parser` (T4, 4 syms)
- **MOVE_DOWN** `bun_shell::CharIter`→`shell_parser`, `bun_shell::ShellCharIter`→`shell_parser`, `bun_shell::has_eq_sign`→`shell_parser`
- **TYPE_ONLY** `bun_shell::StringEncoding`→`shell_parser`

### `sourcemap` (T4, 2 syms)
- **MOVE_DOWN** `bun_standalone_graph::SerializedSourceMap::Loaded`→`sourcemap`, `SavedSourceMap`→`sourcemap`

### `bundler` (T5, 21 syms)
- **FORWARD_DECL** `bun_bundler_jsc::plugin_runner::{MacroJSCtx, default_macro_js_value}`
- **GENUINE** `bun_jsc::VirtualMachine`, `bun_jsc::initialize`, `bun_jsc::CachedBytecode`, `bun_jsc::EventLoopHandle`, `bun_jsc::hot_reloader`, `bun_bake::DevServer`, `bun_resolver::package_json`
- **MOVE_DOWN** `bun_runtime::node::fs::NodeFS::write_file_with_path_buffer`→`sys`, `bun_jsc::RuntimeTranspilerCache`→`bundler`, `bun_bake::get_hmr_runtime`→`bundler`, `bun_resolver::fs`→`fs`, `bun_resolver::data_url`→`data_url`, `bun_resolver::node_fallbacks`→`node_fallbacks`
- **TYPE_ONLY** `bun_jsc::api`→`bundler`, `bun_bake::Side`→`bundler`, `bun_bake::Graph`→`bundler`, `bun_bake::BuiltInModule`→`bundler`, `bun_bake::Framework`→`bundler`, `bun_bundler_jsc::output_file_jsc::SavedFile`→`bundler`, `bun_resolver::SideEffects`→`options_types`

### `http` (T5, 7 syms)
- **GENUINE** `bun_runtime::webcore::FetchHeaders`, `bun_runtime::webcore::blob::Any`
- **MOVE_DOWN** `bun_runtime::api::server::server_config::SSLConfig`→`http`, `bun_runtime::api::server::server_config::ssl_config::SharedPtr`→`http`, `bun_runtime::socket::ssl_wrapper::SSLWrapper`→`http`, `bun_runtime::socket::ssl_wrapper::Handlers`→`http`
- **TYPE_ONLY** `bun_runtime::webcore::fetch_headers::HeaderName`→`http_types`

### `install` (T5, 15 syms)
- **FORWARD_DECL** `bun_resolver::DirInfo`
- **GENUINE** `bun_cli::BuildCommand`
- **MOVE_DOWN** `bun_cli::RunCommand`→`install`, `bun_cli::run_command::replace_package_manager_run`→`install::lifecycle_script_runner`, `bun_cli::package_manager_command::PackageManagerCommand`→`install::PackageManager::CommandLineArguments`, `bun_cli::ShellCompletions`→`install`, `bun_cli::Arguments`→`bunfig`, `bun_jsc::subprocess`→`spawn`, `bun_jsc::url`→`url`, `bun_jsc::URL`→`url`, `bun_jsc::wtf`→`wtf`, `bun_jsc::EventLoopHandle`→`event_loop`, `node::fs::NodeFS`→`sys`, `bun_resolver::is_package_path`→`paths`, `bun_resolver::fs`→`fs`

### `resolver` (T5, 3 syms)
- **MOVE_DOWN** `bun_cli::debug_flags`→`core`, `bun_jsc::wtf`→`http_types`
- **TYPE_ONLY** `bun_bake::framework::BuiltInModule`→`options_types`

### `s3_signing` (T5, 2 syms)
- **GENUINE** `bun_jsc::VirtualMachine`
- **MOVE_DOWN** `bun_runtime::webcore::s3::multipart_options::MultiPartUploadOptions`→`s3_signing`


---

## Per-target-crate move-in tasks

One agent per target crate. Add the listed symbols (type defs / fns) by
extracting them from the `from` crate's `.zig` (NOT its `.rs` — the `.rs` may
already be edited by move-out). New leaf crates (`js_ast`, `spawn`, `lock`,
`debug`, `output`, `fs`): create `src/<name>/lib.rs` with the listed symbols.

### → `core` (31 incoming)
- from `aio`: `bun_jsc::mark_binding`
- from `bun_alloc`: `VirtualMachine::is_smol_mode`, `bun_safety::ThreadLock`, `bun_paths::PathBuffer`
- from `bun_core`: `bun_str::ZStr`, `bun_str::zstr`, `bun_str::strings`, `bun_sys::Fd`, `bun_sys::fd`, `bun_sys::coreutils_error_map`, `bun_analytics::features`, `bun_crash_handler::is_panicking`, `bun_crash_handler::sleep_forever_if_another_thread_is_crashing`, `bun_js_parser::js_printer`, `bun_js_parser::js_lexer`, `bun_threading::Mutex`, `bun_io::Writer`, `bun_paths::SEP`, `bun_paths::PathBuffer`, `bun_semver::Version`, `bun_sys::Winsize`, `bun_paths::OSPathSlice`
- from `collections`: `bun_crash_handler::StoredTrace`, `bun_crash_handler::dump_stack_trace`
- from `event_loop`: `bun_jsc::mark_binding`
- from `paths`: `bun_string::ZStr`, `bun_string::WStr`
- from `resolver`: `bun_cli::debug_flags`
- from `sys`: `bun_crash_handler::DumpOptions`
- from `uws_sys`: `bun_str::ZStr`, `bun_sys::Fd`

### → `js_ast` (13 incoming)
- from `css`: `bun_js_parser::ast`, `bun_js_parser::Symbol`, `bun_js_parser::symbol`
- from `ini`: `e`, `E`, `Expr`, `ExprData`, `e::object::Rope`
- from `interchange`: `bun_js_parser::ast`, `bun_js_parser::lexer`, `bun_js_parser::ExprNodeList`, `bun_js_parser::js_ast`, `bun_js_parser::js_printer`

### → `options_types` (12 incoming)
- from `analytics`: `module_loader::HardcodedModule`
- from `bundler`: `bun_resolver::SideEffects`
- from `cli`: `bun_jsc::config`
- from `css`: `bun_bundler::options::Target`
- from `js_parser`: `bun_bundler::options`, `bun_bake::Framework`
- from `js_printer`: `bun_bundler::options`
- from `options_types`: `coverage::Fraction`, `bun_bundler::options::Loader`, `bun_js_parser::Index`
- from `resolver`: `bun_bake::framework::BuiltInModule`
- from `watcher`: `bun_bundler::options::Loader`

### → `string` (11 incoming)
- from `css`: `bun_bundler::cheap_prefix_normalizer`
- from `interchange`: `wtf::parse_double`
- from `js_parser`: `bun_js_printer::quote_for_json`
- from `paths`: `bun_string::strings`
- from `picohttp`: `printer::write_json_string`
- from `string`: `bun_js_parser::js_lexer`, `bun_js_parser::lexer`, `bun_js_parser::lexer_tables`, `bun_js_parser::printer`, `bun_jsc::webcore::encoding`, `bun_jsc::node::Encoding`

### → `bundler` (8 incoming)
- from `bundler`: `bun_jsc::RuntimeTranspilerCache`, `bun_bake::get_hmr_runtime`, `bun_jsc::api`, `bun_bake::Side`, `bun_bake::Graph`, `bun_bake::BuiltInModule`, `bun_bake::Framework`, `bun_bundler_jsc::output_file_jsc::SavedFile`

### → `sys` (8 incoming)
- from `bake`: `bun_runtime::node::os::totalmem`, `bun_runtime::node::os::freemem`
- from `bundler`: `bun_runtime::node::fs::NodeFS::write_file_with_path_buffer`
- from `glob`: `bun_runtime::node::dir_iterator`
- from `install`: `node::fs::NodeFS`
- from `sys`: `bun_runtime::node`, `generate_header`, `bun_jsc::SystemError`

### → `js_parser` (7 incoming)
- from `css`: `bun_bundler::Ref`, `bun_bundler::v2`
- from `js_parser`: `bun_bundler::defines`, `bun_jsc::math`, `bun_jsc::RuntimeTranspilerCache`, `bun_js_printer::renamer`, `bun_js_printer::Options::Indentation`

### → `paths` (7 incoming)
- from `install`: `bun_resolver::is_package_path`
- from `js_parser`: `bun_resolver::fs`
- from `logger`: `fs::Path`, `fs::PathContentsPair`
- from `paths`: `bun_resolver::fs`, `bun_sys::windows::long_path_prefix_for`
- from `string`: `bun_sys::windows`

### → `spawn` (7 incoming)
- from `cli`: `bun_runtime::spawn`, `bun_runtime::spawn_sync`, `bun_runtime::process`, `bun_runtime::SpawnSyncOptions`, `bun_runtime::Stdio`, `bun_runtime::WindowsSpawnOptions`
- from `install`: `bun_jsc::subprocess`

### → `url` (6 incoming)
- from `bake`: `bun_jsc::URL`
- from `install`: `bun_jsc::url`, `bun_jsc::URL`
- from `js_parser`: `bun_jsc::URL`
- from `url`: `bun_jsc::URL`, `bun_router::param::List`

### → `fs` (5 incoming)
- from `bundler`: `bun_resolver::fs`
- from `dotenv`: `bun_resolver::fs`
- from `install`: `bun_resolver::fs`
- from `options_types`: `PackageManager::fetch_cache_directory_path`
- from `router`: `bun_resolver::fs`

### → `http_types` (5 incoming)
- from `http`: `bun_runtime::webcore::fetch_headers::HeaderName`
- from `http_jsc`: `bun_runtime::api::server_config::SSLConfig`
- from `http_types`: `bun_http::Headers`
- from `resolver`: `bun_jsc::wtf`
- from `uws_sys`: `bun_http::Method`

### → `output` (5 incoming)
- from `bun_alloc`: `bun_core::declare_scope`, `bun_core::scoped_log`, `bun_core::output`, `bun_core::Output`
- from `http_jsc`: `bun_jsc::mark_binding`

### → `alloc` (4 incoming)
- from `bun_alloc`: `bun_str::String`, `bun_sys::page_size`, `bun_core::out_of_memory`
- from `threading`: `wtf::release_fast_malloc_free_memory_for_this_thread`

### → `debug` (4 incoming)
- from `ptr`: `bun_crash_handler::StoredTrace`
- from `safety`: `bun_crash_handler::StoredTrace`, `bun_crash_handler::DumpOptions`, `bun_crash_handler::DumpStackTraceOptions`

### → `http` (4 incoming)
- from `http`: `bun_runtime::api::server::server_config::SSLConfig`, `bun_runtime::api::server::server_config::ssl_config::SharedPtr`, `bun_runtime::socket::ssl_wrapper::SSLWrapper`, `bun_runtime::socket::ssl_wrapper::Handlers`

### → `shell_escape` (4 incoming)
- from `cli`: `bun_shell::needs_escape_utf8_ascii_latin1`, `bun_shell::escape_8bit`
- from `runtime`: `bun_shell::needs_escape_bunstr`, `bun_shell::escape_bun_str`

### → `shell_parser` (4 incoming)
- from `shell_parser`: `bun_shell::CharIter`, `bun_shell::ShellCharIter`, `bun_shell::has_eq_sign`, `bun_shell::StringEncoding`

### → `event_loop` (3 incoming)
- from `cli`: `bun_jsc::EventLoopHandle`
- from `event_loop`: `bun_jsc::Task`
- from `install`: `bun_jsc::EventLoopHandle`

### → `io` (3 incoming)
- from `io`: `bun_aio::Waker`, `bun_aio::Closer`, `bun_runtime::webcore::PathOrFileDescriptor`

### → `semver` (3 incoming)
- from `semver`: `bun_install_types::sliced_string::SlicedString`, `bun_install_types::external_string::ExternalString`, `bun_install_types::semver_string::String`

### → `windows_sys` (3 incoming)
- from `bun_core`: `bun_sys::windows`
- from `errno`: `bun_sys::windows`
- from `windows_sys`: `bun_sys::windows`

### → `install` (2 incoming)
- from `install`: `bun_cli::RunCommand`, `bun_cli::ShellCompletions`

### → `install_types` (2 incoming)
- from `ini`: `bun_install::PnpmMatcher`, `bun_install::npm::Registry::DEFAULT_URL`

### → `js_printer` (2 incoming)
- from `js_printer`: `bun_bundler::analyze_transpiled_module`, `bun_bundler::MangledProps`

### → `lock` (2 incoming)
- from `bun_alloc`: `bun_threading::Mutex`, `bun_threading::Guarded`

### → `logger` (2 incoming)
- from `logger`: `bun_js_parser::Index`, `bun_options_types::ImportKind`

### → `sha_hmac` (2 incoming)
- from `csrf`: `bun_jsc::api::bun::crypto::evp::Algorithm`
- from `sha_hmac`: `api (bun_jsc::api::bun::crypto::evp::Algorithm)`

### → `sourcemap` (2 incoming)
- from `sourcemap`: `bun_standalone_graph::SerializedSourceMap::Loaded`, `SavedSourceMap`

### → `uws_sys` (2 incoming)
- from `io`: `bun_uws::Loop`
- from `uws_sys`: `bun_uws::SocketAddress`

### → `base64` (1 incoming)
- from `crash_handler`: `bun_sourcemap::VLQ`

### → `boringssl` (1 incoming)
- from `boringssl`: `bun_runtime::api::bun::x509::is_safe_alt_name`

### → `bunfig` (1 incoming)
- from `install`: `bun_cli::Arguments`

### → `crash_handler` (1 incoming)
- from `crash_handler`: `bun_cli::Cli`

### → `data_url` (1 incoming)
- from `bundler`: `bun_resolver::data_url`

### → `dns` (1 incoming)
- from `cli`: `bun_runtime::api`

### → `errno` (1 incoming)
- from `errno`: `bun_sys::posix`

### → `install::PackageManager::CommandLineArguments` (1 incoming)
- from `install`: `bun_cli::package_manager_command::PackageManagerCommand`

### → `install::lifecycle_script_runner` (1 incoming)
- from `install`: `bun_cli::run_command::replace_package_manager_run`

### → `jsc` (1 incoming)
- from `jsc`: `bun_runtime::server`

### → `jsc_core` (1 incoming)
- from `http_jsc`: `bun_jsc::host_fn`

### → `jsc_sys` (1 incoming)
- from `cli`: `bun_jsc::RegularExpression`

### → `node_fallbacks` (1 incoming)
- from `bundler`: `bun_resolver::node_fallbacks`

### → `router` (1 incoming)
- from `router`: `options::RouteConfig`

### → `runtime` (1 incoming)
- from `jsc`: `bun_runtime::valkey_jsc`

### → `s3_signing` (1 incoming)
- from `s3_signing`: `bun_runtime::webcore::s3::multipart_options::MultiPartUploadOptions`

### → `safety` (1 incoming)
- from `safety`: `bun_threading::ThreadId`

### → `stays` (1 incoming)
- from `bun_core`: `bun_sys::CreateFileOptions`

### → `transpiler` (1 incoming)
- from `cli`: `bun_jsc::RuntimeTranspilerCache`

### → `uws` (1 incoming)
- from `http_jsc`: `bun_runtime::socket::ssl_wrapper::SslWrapper`

### → `wtf` (1 incoming)
- from `install`: `bun_jsc::wtf`

