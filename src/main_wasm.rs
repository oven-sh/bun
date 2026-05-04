use core::ffi::c_void;
use core::mem::MaybeUninit;

use bun_alloc::Arena; // bumpalo::Bump re-export (was MimallocArena)
use bun_alloc::mimalloc;
use bun_bundler::defines as define_mod;
use bun_bundler::options as options_mod;
use bun_core::Output;
use bun_js_parser as js_parser;
use bun_js_parser::ast as js_ast;
use bun_js_parser::printer as js_printer;
use bun_logger as logger;
use bun_schema::api;
use bun_schema::Reader as ApiReader;
use bun_schema::Writer as ApiWriter;

#[unsafe(no_mangle)]
pub static mut code_buffer_ptr: *const u8 = core::ptr::null();

pub const BINDGEN: bool = true;

// TODO(port): Zig `pub const os = struct { pub const c = system; pub const system = system; }`
// was a std-override hook for the WASM target. Rust has no equivalent std-hijack mechanism;
// Phase B decides whether a `#[cfg(target_arch = "wasm32")]` shim crate is needed.
pub mod os {
    pub use super::system as c;
    pub use super::system;
}

unsafe extern "C" {
    // TODO(port): move to <area>_sys
    pub fn console_error(slice: u64);
    pub fn console_log(slice: u64);
    pub fn console_warn(slice: u64);
    pub fn console_info(slice: u64);
}

#[repr(C)]
pub struct Uint8Array {
    pub ptr: *const u8,
    pub len: usize,
}

impl Default for Uint8Array {
    fn default() -> Self {
        Self { ptr: core::ptr::null(), len: 0 }
    }
}

impl Uint8Array {
    pub fn from_slice(slice: &[u8]) -> u64 {
        // SAFETY: wasm32 — pointers are 32-bit; pack (ptr, len) into a u64 exactly as Zig did.
        unsafe {
            core::mem::transmute::<[u32; 2], u64>([
                slice.as_ptr() as usize as u32,
                u32::try_from(slice.len()).unwrap(),
            ])
        }
    }

    pub fn from_js(data: u64) -> &'static mut [u8] {
        // SAFETY: wasm32 — unpack (ptr, len) from a u64; caller (JS host) guarantees the
        // region was produced by `bun_malloc` and is live.
        unsafe {
            let ptrs = core::mem::transmute::<u64, [u32; 2]>(data);
            core::slice::from_raw_parts_mut(ptrs[0] as usize as *mut u8, ptrs[1] as usize)
        }
    }
}

pub mod system {
    pub type FdT = i32;
    pub type Sockaddr = FdT;
    pub type ModeT = FdT;

    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq)]
    pub enum E {
        SUCCESS = 0,
        EPERM = 1,
        ENOENT = 2,
        ESRCH = 3,
        EINTR = 4,
        EIO = 5,
        ENXIO = 6,
        E2BIG = 7,
        ENOEXEC = 8,
        EBADF = 9,
        ECHILD = 10,
        EDEADLK = 11,
        ENOMEM = 12,
        EACCES = 13,
        EFAULT = 14,
        ENOTBLK = 15,
        EBUSY = 16,
        EEXIST = 17,
        EXDEV = 18,
        ENODEV = 19,
        ENOTDIR = 20,
        EISDIR = 21,
        EINVAL = 22,
        ENFILE = 23,
        EMFILE = 24,
        ENOTTY = 25,
        ETXTBSY = 26,
        EFBIG = 27,
        ENOSPC = 28,
        ESPIPE = 29,
        EROFS = 30,
        EMLINK = 31,
        EPIPE = 32,
        EDOM = 33,
        ERANGE = 34,
        EAGAIN = 35,
        EINPROGRESS = 36,
        EALREADY = 37,
        ENOTSOCK = 38,
        EDESTADDRREQ = 39,
        EMSGSIZE = 40,
        EPROTOTYPE = 41,
        ENOPROTOOPT = 42,
        EPROTONOSUPPORT = 43,
        ESOCKTNOSUPPORT = 44,
        ENOTSUP = 45,
        EPFNOSUPPORT = 46,
        EAFNOSUPPORT = 47,
        EADDRINUSE = 48,
        EADDRNOTAVAIL = 49,
        ENETDOWN = 50,
        ENETUNREACH = 51,
        ENETRESET = 52,
        ECONNABORTED = 53,
        ECONNRESET = 54,
        ENOBUFS = 55,
        EISCONN = 56,
        ENOTCONN = 57,
        ESHUTDOWN = 58,
        ETOOMANYREFS = 59,
        ETIMEDOUT = 60,
        ECONNREFUSED = 61,
        ELOOP = 62,
        ENAMETOOLONG = 63,
        EHOSTDOWN = 64,
        EHOSTUNREACH = 65,
        ENOTEMPTY = 66,
        EPROCLIM = 67,
        EUSERS = 68,
        EDQUOT = 69,
        ESTALE = 70,
        EREMOTE = 71,
        EBADRPC = 72,
        ERPCMISMATCH = 73,
        EPROGUNAVAIL = 74,
        EPROGMISMATCH = 75,
        EPROCUNAVAIL = 76,
        ENOLCK = 77,
        ENOSYS = 78,
        EFTYPE = 79,
        EAUTH = 80,
        ENEEDAUTH = 81,
        EPWROFF = 82,
        EDEVERR = 83,
        EOVERFLOW = 84,
        EBADEXEC = 85,
        EBADARCH = 86,
        ESHLIBVERS = 87,
        EBADMACHO = 88,
        ECANCELED = 89,
        EIDRM = 90,
        ENOMSG = 91,
        EILSEQ = 92,
        ENOATTR = 93,
        EBADMSG = 94,
        EMULTIHOP = 95,
        ENODATA = 96,
        ENOLINK = 97,
        ENOSR = 98,
        ENOSTR = 99,
        EPROTO = 100,
        ETIME = 101,
        EOPNOTSUPP = 102,
        ENOPOLICY = 103,
        ENOTRECOVERABLE = 104,
        EOWNERDEAD = 105,
        EQFULL = 106,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn cycleStart() {}
#[unsafe(no_mangle)]
pub extern "C" fn cycleEnd() {}

// SAFETY: wasm32 is single-threaded; these module-level mutables mirror Zig `var` globals.
// TODO(port): consider wrapping in a `struct WasmState` + `static STATE: UnsafeCell<...>` in Phase B.
static mut TRANSFORM_RESPONSE: MaybeUninit<api::TransformResponse> = MaybeUninit::uninit();
static mut OUTPUT_FILES: [MaybeUninit<api::OutputFile>; 1] = [MaybeUninit::uninit()];
static mut BUFFER_WRITER: MaybeUninit<js_printer::BufferWriter> = MaybeUninit::uninit();
static mut WRITER: MaybeUninit<js_printer::BufferPrinter> = MaybeUninit::uninit();
static mut DEFINE: MaybeUninit<*mut define_mod::Define> = MaybeUninit::uninit();

#[unsafe(no_mangle)]
pub extern "C" fn bun_malloc(size: usize) -> u64 {
    // PERF(port): Zig used default_allocator.alloc; Rust global allocator is mimalloc.
    let mut v = vec![0u8; size].into_boxed_slice();
    let ptr = v.as_mut_ptr();
    core::mem::forget(v);
    // SAFETY: wasm32 — pack (ptr, len) into u64.
    unsafe {
        core::mem::transmute::<[u32; 2], u64>([
            ptr as usize as u32,
            u32::try_from(size).unwrap(),
        ])
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn bun_free(bytes: u64) {
    let slice = Uint8Array::from_js(bytes);
    // SAFETY: pointer/len were produced by `bun_malloc` above via `Box<[u8]>::into_raw`-equivalent.
    unsafe {
        drop(Box::from_raw(slice as *mut [u8]));
    }
}

static mut OUTPUT_STREAM_BUF: [u8; 16384] = [0; 16384];
// TODO(port): `std.io.fixedBufferStream` — Phase B needs a `bun_io::FixedBufferStream` or
// `std::io::Cursor<&mut [u8]>` here. Left as cursors over the static buffers.
static mut ERROR_STREAM_BUF: [u8; 16384] = [0; 16384];
static mut OUTPUT_SOURCE: MaybeUninit<bun_core::output::Source> = MaybeUninit::uninit();
static mut INIT_COUNTER: usize = 0;

#[unsafe(no_mangle)]
pub extern "C" fn init(heapsize: u32) {
    // SAFETY: wasm32 single-threaded; exclusive access to module statics.
    unsafe {
        let counter = INIT_COUNTER;
        INIT_COUNTER = INIT_COUNTER.wrapping_add(1);
        if counter == 0 {
            // reserve 256 MB upfront
            mimalloc::mi_option_set(mimalloc::Option::AllowDecommit, 0);
            mimalloc::mi_option_set(mimalloc::Option::LimitOsAlloc, 1);
            let _ = mimalloc::mi_reserve_os_memory(heapsize as usize, false, true);

            js_ast::Stmt::Data::Store::create();
            js_ast::Expr::Data::Store::create();
            let mut bw = js_printer::BufferWriter::init();
            bw.buffer.grow_by(1024).expect("unreachable");
            BUFFER_WRITER.write(bw);
            WRITER.write(js_printer::BufferPrinter::init(core::ptr::read(BUFFER_WRITER.as_ptr())));
            DEFINE.write(Box::into_raw(Box::new(
                define_mod::Define::init(None, None).expect("unreachable"),
            )));
            // TODO(port): Output.Source.init wants writer streams; wire FixedBufferStream in Phase B.
            OUTPUT_SOURCE.write(bun_core::output::Source::init(
                &mut OUTPUT_STREAM_BUF[..],
                &mut ERROR_STREAM_BUF[..],
            ));
            bun_core::output::Source::set(OUTPUT_SOURCE.assume_init_mut());
        } else {
            BUFFER_WRITER.write(core::ptr::read(&WRITER.assume_init_ref().ctx));
        }
    }
}

static mut LOG: MaybeUninit<logger::Log> = MaybeUninit::uninit();

struct TestAnalyzer {
    string_buffer: Vec<u8>,
    items: Vec<api::TestResponseItem>,
}

impl TestAnalyzer {
    pub fn visit_expr(
        &mut self,
        parser: &mut js_parser::TSXParser,
        expr: js_ast::Expr,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        match expr.data {
            js_ast::ExprData::ECall(call) => {
                if call.target.is_ref(parser.jest.test)
                    || call.target.is_ref(parser.jest.it)
                    || call.target.is_ref(parser.jest.describe)
                {
                    if call.args.len() > 0 {
                        let label_expr: js_ast::Expr = call.args.slice()[0];
                        match label_expr.data {
                            js_ast::ExprData::EString(str_) => {
                                str_.to_utf8()?;
                                let ptr = api::StringPointer {
                                    offset: u32::try_from(self.string_buffer.len()).unwrap(),
                                    length: u32::try_from(str_.data.len()).unwrap(),
                                };
                                self.string_buffer.extend_from_slice(&str_.data);
                                self.items.push(api::TestResponseItem {
                                    byte_offset: expr.loc.start,
                                    kind: if call.target.is_ref(parser.jest.describe) {
                                        api::TestKind::DescribeFn
                                    } else {
                                        api::TestKind::TestFn
                                    },
                                    label: ptr,
                                });
                            }
                            js_ast::ExprData::EDot(_) => {}
                            _ => {}
                        }

                        return Ok(());
                    }
                } else if matches!(call.target.data, js_ast::ExprData::EDot(_))
                    && {
                        let js_ast::ExprData::EDot(dot) = &call.target.data else { unreachable!() };
                        dot.name == b"only"
                    }
                {
                    let js_ast::ExprData::EDot(dot) = &call.target.data else { unreachable!() };
                    let target = dot.target;
                    if target.is_ref(parser.jest.test)
                        || target.is_ref(parser.jest.it)
                        || target.is_ref(parser.jest.describe)
                    {
                        if call.args.len() > 0 {
                            let label_expr: js_ast::Expr = call.args.slice()[0];
                            match label_expr.data {
                                js_ast::ExprData::EString(str_) => {
                                    str_.to_utf8()?;
                                    let ptr = api::StringPointer {
                                        offset: u32::try_from(self.string_buffer.len()).unwrap(),
                                        length: u32::try_from(str_.data.len()).unwrap(),
                                    };
                                    self.string_buffer.extend_from_slice(&str_.data);
                                    self.items.push(api::TestResponseItem {
                                        byte_offset: expr.loc.start,
                                        kind: if target.is_ref(parser.jest.describe) {
                                            api::TestKind::DescribeFn
                                        } else {
                                            api::TestKind::TestFn
                                        },
                                        label: ptr,
                                    });
                                }
                                js_ast::ExprData::EDot(_) => {}
                                _ => {}
                            }

                            return Ok(());
                        }
                    }
                }

                self.visit_expr(parser, call.target)?;
                for arg in call.args.slice() {
                    self.visit_expr(parser, *arg)?;
                }
            }
            js_ast::ExprData::EBinary(bin) => {
                self.visit_expr(parser, bin.left)?;
                self.visit_expr(parser, bin.right)?;
            }
            js_ast::ExprData::ENew(new) => {
                self.visit_expr(parser, new.target)?;
                for arg in new.args.slice() {
                    self.visit_expr(parser, *arg)?;
                }
            }

            js_ast::ExprData::EArray(arr) => {
                for item in arr.items.slice() {
                    self.visit_expr(parser, *item)?;
                }
            }

            js_ast::ExprData::EIf(if_) => {
                self.visit_expr(parser, if_.no)?;
                self.visit_expr(parser, if_.test_)?;
                self.visit_expr(parser, if_.yes)?;
            }

            js_ast::ExprData::EFunction(func) => {
                for stmt in func.func.body.stmts {
                    self.visit_stmt(parser, *stmt)?;
                }
            }

            js_ast::ExprData::EArrow(arrow) => {
                for stmt in arrow.body.stmts {
                    self.visit_stmt(parser, *stmt)?;
                }
            }
            _ => {}
        }
        Ok(())
    }

    pub fn visit_stmt(
        &mut self,
        parser: &mut js_parser::TSXParser,
        stmt: js_ast::Stmt,
    ) -> Result<(), bun_core::Error> {
        match stmt.data {
            js_ast::StmtData::SBlock(s) => {
                for s2 in s.stmts {
                    self.visit_stmt(parser, *s2)?;
                }
            }
            js_ast::StmtData::SDoWhile(s) => {
                self.visit_stmt(parser, s.body)?;
                self.visit_expr(parser, s.test_)?;
            }
            js_ast::StmtData::SExpr(s) => {
                self.visit_expr(parser, s.value)?;
            }
            js_ast::StmtData::SForIn(s) => {
                self.visit_stmt(parser, s.init)?;
                self.visit_stmt(parser, s.body)?;
                self.visit_expr(parser, s.value)?;
            }
            js_ast::StmtData::SForOf(s) => {
                self.visit_stmt(parser, s.init)?;
                self.visit_stmt(parser, s.body)?;
                self.visit_expr(parser, s.value)?;
            }
            js_ast::StmtData::SFor(s) => {
                if let Some(i) = s.init {
                    self.visit_stmt(parser, i)?;
                }
                if let Some(i) = s.test_ {
                    self.visit_expr(parser, i)?;
                }
                if let Some(i) = s.update {
                    self.visit_expr(parser, i)?;
                }

                self.visit_stmt(parser, s.body)?;
            }
            js_ast::StmtData::SFunction(s) => {
                for arg in s.func.args {
                    if let Some(def) = arg.default {
                        self.visit_expr(parser, def)?;
                    }
                }

                for s2 in s.func.body.stmts {
                    self.visit_stmt(parser, *s2)?;
                }
            }
            js_ast::StmtData::SIf(s) => {
                self.visit_expr(parser, s.test_)?;
                self.visit_stmt(parser, s.yes)?;
                if let Some(no) = s.no {
                    self.visit_stmt(parser, no)?;
                }
            }
            js_ast::StmtData::SLocal(s) => {
                for decl in s.decls.slice() {
                    if let Some(val) = decl.value {
                        self.visit_expr(parser, val)?;
                    }
                }
            }
            js_ast::StmtData::SSwitch(s) => {
                self.visit_expr(parser, s.test_)?;
                for c in s.cases {
                    for t in c.body {
                        self.visit_stmt(parser, *t)?;
                    }
                    if let Some(e2) = c.value {
                        self.visit_expr(parser, e2)?;
                    }
                }
            }
            js_ast::StmtData::SThrow(s) => {
                self.visit_expr(parser, s.value)?;
            }
            js_ast::StmtData::STry(s) => {
                for s2 in s.body {
                    self.visit_stmt(parser, *s2)?;
                }
                if let Some(c) = &s.catch_ {
                    for s2 in c.body {
                        self.visit_stmt(parser, *s2)?;
                    }
                }
                if let Some(f) = &s.finally {
                    for s2 in f.stmts {
                        self.visit_stmt(parser, *s2)?;
                    }
                }
            }
            js_ast::StmtData::SWhile(s) => {
                self.visit_expr(parser, s.test_)?;
                self.visit_stmt(parser, s.body)?;
            }

            js_ast::StmtData::SImport(import) => {
                if parser.import_records.as_slice()[import.import_record_index as usize]
                    .path
                    .text
                    == b"bun:test"
                {
                    for item in import.items {
                        let clause: &js_ast::ClauseItem = item;
                        if clause.alias == b"test" {
                            parser.jest.test = clause.name.ref_.unwrap();
                        } else if clause.alias == b"it" {
                            parser.jest.it = clause.name.ref_.unwrap();
                        } else if clause.alias == b"describe" {
                            parser.jest.describe = clause.name.ref_.unwrap();
                        }
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }

    pub fn visit_parts(
        &mut self,
        parser: &mut js_parser::TSXParser,
        parts: &[js_ast::Part],
    ) -> Result<(), bun_core::Error> {
        let jest = &mut parser.jest;
        if parser.symbols.as_slice()[jest.it.inner_index() as usize].use_count_estimate == 0 {
            if parser.symbols.as_slice()[jest.it.inner_index() as usize].use_count_estimate > 0 {
                jest.test = jest.it;
            }
        } else if parser.symbols.as_slice()[jest.test.inner_index() as usize].use_count_estimate == 0 {
            if parser.symbols.as_slice()[jest.it.inner_index() as usize].use_count_estimate > 0 {
                jest.test = jest.it;
            }
        }

        for part in parts {
            for stmt in part.stmts {
                self.visit_stmt(parser, *stmt)?;
            }
        }
        Ok(())
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn getTests(opts_array: u64) -> u64 {
    // PERF(port): was arena bulk-free — profile in Phase B
    let arena = Arena::new();
    let mut log_ = logger::Log::init(&arena);
    let mut reader = ApiReader::init(Uint8Array::from_js(opts_array), &arena);
    let opts = api::GetTestsRequest::decode(&mut reader).expect("oom");
    let mut code = logger::Source::init_path_string(
        if !opts.path.is_empty() { &opts.path } else { b"my-test-file.test.tsx" },
        &opts.contents,
    );
    code.contents_is_recycled = true;

    // Zig: defer { Stmt.Data.Store.reset(); Expr.Data.Store.reset(); }
    let _store_reset = scopeguard::guard((), |_| {
        js_ast::Stmt::Data::Store::reset();
        js_ast::Expr::Data::Store::reset();
    });

    // SAFETY: DEFINE initialized in `init()`.
    let define = unsafe { &mut *DEFINE.assume_init() };
    let mut parser = js_parser::Parser::init(
        js_parser::Options {
            jsx: Default::default(),
            ts: true,
            ..Default::default()
        },
        &mut log_,
        &code,
        define,
        &arena,
    )
    .expect("oom");

    let mut anaylzer = TestAnalyzer {
        items: Vec::new(),
        string_buffer: Vec::new(),
    };
    parser.options.features.inject_jest_globals = true;
    parser.options.features.commonjs_at_runtime = true;
    parser.options.features.top_level_await = true;

    // TODO(port): Zig used `@ptrCast(&TestAnalyzer.visitParts)` to erase the analyzer type.
    // Phase B: `analyze` should take `&mut dyn FnMut(&mut TSXParser, &[Part]) -> Result<..>`
    // or a trait object; here we pass a closure.
    if let Err(err) = parser.analyze(&mut anaylzer, |a, p, parts| a.visit_parts(p, parts)) {
        bun_core::handle_error_return_trace(err);

        Output::print(format_args!("Error: {}\n", err.name()));

        log_.print(Output::writer()).expect("unreachable");
        return 0;
    }

    let mut output: Vec<u8> = Vec::new();
    let mut encoder = ApiWriter::init(&mut output);
    let response = api::GetTestsResponse {
        tests: anaylzer.items.as_slice(),
        contents: anaylzer.string_buffer.as_slice(),
    };

    let Ok(()) = response.encode(&mut encoder) else { return 0 };
    // SAFETY: wasm32 — pack (ptr, len) into u64; output is leaked to JS via bun_free.
    let packed = unsafe {
        core::mem::transmute::<[u32; 2], u64>([
            output.as_ptr() as usize as u32,
            u32::try_from(output.len()).unwrap(),
        ])
    };
    core::mem::forget(output);
    packed
}

#[unsafe(no_mangle)]
pub extern "C" fn transform(opts_array: u64) -> u64 {
    // var arena = bun.ArenaAllocator.init(default_allocator);
    // PERF(port): was arena bulk-free — profile in Phase B
    let arena = Arena::new();
    // SAFETY: wasm32 single-threaded; exclusive access to LOG.
    unsafe { LOG.write(logger::Log::init(&arena)) };
    let log = unsafe { LOG.assume_init_mut() };

    let mut reader = ApiReader::init(Uint8Array::from_js(opts_array), &arena);
    let opts = api::Transform::decode(&mut reader).expect("unreachable");
    let loader_ = opts.loader.unwrap_or(api::Loader::Tsx);

    let _store_reset = scopeguard::guard((), |_| {
        js_ast::Stmt::Data::Store::reset();
        js_ast::Expr::Data::Store::reset();
    });
    let loader: options_mod::Loader = match loader_ {
        api::Loader::Jsx => options_mod::Loader::Jsx,
        api::Loader::Js => options_mod::Loader::Js,
        api::Loader::Ts => options_mod::Loader::Ts,
        api::Loader::Tsx => options_mod::Loader::Tsx,
        _ => options_mod::Loader::File,
    };
    let path = opts.path.unwrap_or_else(|| loader.stdin_name());
    let mut code = logger::Source::init_path_string(path, &opts.contents);
    code.contents_is_recycled = true;

    // SAFETY: DEFINE initialized in `init()`.
    let define = unsafe { &mut *DEFINE.assume_init() };
    let mut parser = js_parser::Parser::init(
        js_parser::Options { jsx: Default::default(), ..Default::default() },
        log,
        &code,
        define,
        &arena,
    )
    .expect("unreachable");
    parser.options.jsx.parse = loader.is_jsx();
    parser.options.ts = loader.is_typescript();
    parser.options.tree_shaking = false;
    parser.options.features.top_level_await = true;
    let result = parser.parse().expect("unreachable");

    // SAFETY: wasm32 single-threaded; exclusive access to module statics.
    unsafe {
        let writer = WRITER.assume_init_mut();
        if matches!(result, js_parser::ParseResult::Ast(_)) && log.errors == 0 {
            let js_parser::ParseResult::Ast(ast) = &result else { unreachable!() };
            let symbols =
                js_ast::Symbol::NestedList::init(core::slice::from_ref(&ast.symbols));

            let _ = js_printer::print_ast(
                writer,
                ast,
                js_ast::Symbol::Map::init_list(symbols),
                &code,
                false,
                Default::default(),
                false,
            )
            .unwrap_or(0);

            OUTPUT_FILES[0].write(api::OutputFile { data: writer.ctx.written, path });
            writer.ctx.reset();
            writer.written = 0;
            BUFFER_WRITER.write(core::ptr::read(&writer.ctx));
        } else {
            OUTPUT_FILES[0].write(api::OutputFile { data: b"", path });
        }

        TRANSFORM_RESPONSE.write(api::TransformResponse {
            status: if matches!(result, js_parser::ParseResult::Ast(_)) && log.errors == 0 {
                api::TransformResponseStatus::Success
            } else {
                api::TransformResponseStatus::Fail
            },
            files: core::slice::from_raw_parts(OUTPUT_FILES.as_ptr() as *const api::OutputFile, 1),
            errors: log.to_api(&arena).expect("unreachable").msgs,
        });

        let mut output: Vec<u8> = Vec::new();
        let mut encoder = ApiWriter::init(&mut output);
        let _ = TRANSFORM_RESPONSE.assume_init_ref().encode(&mut encoder);
        let packed = core::mem::transmute::<[u32; 2], u64>([
            output.as_ptr() as usize as u32,
            u32::try_from(output.len()).unwrap(),
        ]);
        core::mem::forget(output);
        packed
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn scan(opts_array: u64) -> u64 {
    // var arena = bun.ArenaAllocator.init(default_allocator);
    // PERF(port): was arena bulk-free — profile in Phase B
    let arena = Arena::new();
    // SAFETY: wasm32 single-threaded; exclusive access to LOG.
    unsafe { LOG.write(logger::Log::init(&arena)) };
    let log = unsafe { LOG.assume_init_mut() };

    let mut reader = ApiReader::init(Uint8Array::from_js(opts_array), &arena);
    let opts = api::Scan::decode(&mut reader).expect("unreachable");
    let loader_ = opts.loader.unwrap_or(api::Loader::Tsx);

    let _store_reset = scopeguard::guard((), |_| {
        js_ast::Stmt::Data::Store::reset();
        js_ast::Expr::Data::Store::reset();
    });
    let loader: options_mod::Loader = match loader_ {
        api::Loader::Jsx => options_mod::Loader::Jsx,
        api::Loader::Js => options_mod::Loader::Js,
        api::Loader::Ts => options_mod::Loader::Ts,
        api::Loader::Tsx => options_mod::Loader::Tsx,
        _ => options_mod::Loader::File,
    };
    let path = opts.path.unwrap_or_else(|| loader.stdin_name());
    let mut code = logger::Source::init_path_string(path, &opts.contents);
    code.contents_is_recycled = true;

    // SAFETY: DEFINE initialized in `init()`.
    let define = unsafe { &mut *DEFINE.assume_init() };
    let mut parser = js_parser::Parser::init(
        js_parser::Options { jsx: Default::default(), ..Default::default() },
        log,
        &code,
        define,
        &arena,
    )
    .expect("unreachable");
    parser.options.jsx.parse = loader.is_jsx();
    parser.options.ts = loader.is_typescript();
    parser.options.features.top_level_await = true;
    let result = parser.parse().expect("unreachable");
    if log.errors == 0 {
        // SAFETY: all-zero is a valid api::ScanResult (slices = (null, 0)).
        let mut scan_result: api::ScanResult = unsafe { core::mem::zeroed() };
        let mut output: Vec<u8> = Vec::new();

        // PORT NOTE: reshaped for borrowck — Zig arena-owned scanned_imports; keep the Vec
        // alive in this scope past `encode` and let it drop, instead of leaking.
        let mut scanned_imports: Vec<api::ScannedImport> = Vec::new();
        if let js_parser::ParseResult::Ast(ast) = &result {
            scanned_imports.reserve_exact(ast.import_records.len());
            for import_record in ast.import_records.slice() {
                if import_record.kind == bun_options_types::ImportKind::Internal {
                    continue;
                }
                scanned_imports.push(api::ScannedImport {
                    path: import_record.path.text,
                    kind: import_record.kind.to_api(),
                });
            }

            scan_result = api::ScanResult {
                exports: ast.named_exports.keys(),
                imports: scanned_imports.as_slice(),
                errors: log.to_api(&arena).expect("unreachable").msgs,
            };
        }

        let mut encoder = ApiWriter::init(&mut output);
        scan_result.encode(&mut encoder).expect("unreachable");
        // SAFETY: wasm32 — pack (ptr, len) into u64; output is leaked to JS via bun_free.
        let packed = unsafe {
            core::mem::transmute::<[u32; 2], u64>([
                output.as_ptr() as usize as u32,
                u32::try_from(output.len()).unwrap(),
            ])
        };
        core::mem::forget(output);
        packed
    } else {
        let mut output: Vec<u8> = Vec::new();
        let scan_result = api::ScanResult {
            exports: &[],
            imports: &[],
            errors: log.to_api(&arena).expect("unreachable").msgs,
        };
        let mut encoder = ApiWriter::init(&mut output);
        scan_result.encode(&mut encoder).expect("unreachable");
        // SAFETY: wasm32 — pack (ptr, len) into u64; output is leaked to JS via bun_free.
        let packed = unsafe {
            core::mem::transmute::<[u32; 2], u64>([
                output.as_ptr() as usize as u32,
                u32::try_from(output.len()).unwrap(),
            ])
        };
        core::mem::forget(output);
        packed
    }
}

// pub fn main() anyerror!void {}

#[unsafe(no_mangle)]
pub extern "C" fn emsc_main() {
    // Zig referenced the export fns to force linkage; Rust `#[no_mangle] pub extern` already
    // guarantees they are emitted. Keep as no-op.
    let _ = (
        emsc_main as extern "C" fn(),
        cycleEnd as extern "C" fn(),
        cycleStart as extern "C" fn(),
        transform as extern "C" fn(u64) -> u64,
        bun_free as extern "C" fn(u64),
        bun_malloc as extern "C" fn(usize) -> u64,
        getTests as extern "C" fn(u64) -> u64,
    );
}

// Zig `comptime { _ = ... }` force-reference block dropped — Rust links what's `pub extern "C"`.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/main_wasm.zig (669 lines)
//   confidence: medium
//   todos:      7
//   notes:      wasm32 entry; heavy static-mut globals + arena threading into bun_js_parser need Phase B rework; ApiWriter generic collapsed to &mut Vec<u8> sink
// ──────────────────────────────────────────────────────────────────────────
