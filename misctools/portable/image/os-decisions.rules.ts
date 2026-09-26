// The rules that sort the OS decisions of os-decisions.ts into classes. The first rule that matches decides.
//
// A rule looks at the file, at the predicate (`text`) and at the code that the decision guards (`context`: its
// first line; `scope`: its first lines). Rules for single files and constructs come first, rules for whole
// directories last. A class that a directory rule gives is a statement about the directory, and is as exact
// as that: the rules for files and constructs are where a decision was read.
import type { Kind } from "./os-decisions.ts";

export type Class = "A" | "B" | "C" | "D" | "R" | "U";

export interface Rule {
  /** Names the rule in the inventory. */
  id: string;
  class: Class;
  /** One line: why the decisions of this rule are in this class. */
  why: string;
  kind?: Kind[];
  /** Matches the path of the file, relative to the repository. */
  file?: RegExp;
  /** Matches the predicate or the expression of the decision. */
  text?: RegExp;
  /** Matches the first line of code that the decision guards. */
  context?: RegExp;
  /** Matches the first lines of code that the decision guards. */
  scope?: RegExp;
}

// What the code of an operating system interface looks like, whatever file it is in.
const nativeInterface =
  /\b(libuv|uv_[a-z]|uv::|kernel32|ntdll|advapi32|ws2_32|winsock|HANDLE|DWORD|NTSTATUS|Win32Error|windows_sys|bun_sys::windows|sys::windows|windows::|WStr|WPathBuffer|w_path_buffer|OSPath|os_path|u16\b|wide|wchar|CreateProcess|CreateFile|GetFileAttributes|NtCreateFile|kqueue|kevent|epoll|io_uring|inotify|fsevents|FSEvents|mach_|sysctl|sysconf|posix_spawn|fork|execve|waitpid|sigaction|signalfd|pidfd|eventfd|timerfd|memfd|mmap|munmap|madvise|mprotect|ioctl|fcntl|termios|tcgetattr|isatty|tty|console|pipe2?\(|socket|sockaddr|getaddrinfo|recvmsg|sendmsg|SOL_|SO_|AF_|MSG_|openat|fstat|lstat|statx|fchmod|fchown|ftruncate|fsync|readlink|symlink|unlink|rename|mkdir|rmdir|getdents|copy_file_range|clonefile|sendfile|splice|O_[A-Z]+|S_IF|libc::|bun_sys::c::|extern "C"|unsafe extern|link_name|RawFd|Fd::|\.native\(\)|rlimit|getrusage|pthread|thread|futex|clock_gettime|dlopen|dlsym)\b/;

export const rules: Rule[] = [
  // ── decided when the program runs ───────────────────────────────────────────────────────────────────────
  {
    id: "runtime-host",
    class: "R",
    why: "asks bun_core::host or Bun::hostOS(): the host decides when the program runs",
    kind: ["runtime-host"],
    file: /\.(rs|cpp|h|c)$/,
  },
  {
    id: "runtime-process-platform",
    class: "R",
    why: "process.platform of a built-in module is the private global @hostPlatform in the portable image",
    kind: ["runtime-host"],
    file: /^src\/js\//,
  },
  {
    id: "runtime-platform-auto",
    class: "R",
    why: "platform::Auto is a type of the portable image that asks the host (PlatformT::platform)",
    kind: ["rust-const"],
    text: /^platform::Auto$/,
  },
  {
    id: "runtime-compiled-where-host-may-be",
    class: "R",
    why: "BUN_HOST_MAY_BE_WINDOWS / _POSIX: compiled where the host may be that OS, chosen when the program runs",
    kind: ["c-preprocessor"],
    text: /BUN_HOST_MAY_BE_/,
  },

  // ── the mechanism itself and what is kept for every other build ────────────────────────────────────────
  {
    id: "mechanism",
    class: "A",
    why: "the definition of the host OS for builds that are not the portable image",
    file: /^src\/(bun_alloc\/host\.rs|bun_core\/host\.rs|bun_core\/env\.rs|jsc\/bindings\/BunHostOS\.h|jsc\/bindings\/BunHostPath\.h)$/,
  },
  {
    id: "kept-beside-portable",
    class: "A",
    why: "the arm of another build beside an arm for the portable image (cfg names bun_portable)",
    kind: ["rust-cfg"],
    text: /bun_portable/,
  },
  {
    id: "libc-flavour",
    class: "A",
    why: "decides by the C library, and the C library of the image is musl on every host",
    kind: ["rust-cfg"],
    text: /^cfg!?\((not\()?target_env = "(musl|gnu)"\)?\)$/,
  },
  {
    id: "tests-of-the-crate",
    class: "D",
    why: "unit tests of a crate: not part of the image",
    kind: ["rust-cfg"],
    text: /\btest\b/,
  },
  {
    id: "not-a-host",
    class: "D",
    why: "FreeBSD, Android, iOS or wasm only: not a host of the image, and not what the image is compiled for",
    kind: ["rust-cfg"],
    text: /^cfg!?\((any\()?(\s*,?\s*(target_os = "(freebsd|android|ios|openbsd|netbsd|dragonfly|emscripten|wasi)"|target_family = "wasm"|target_arch = "wasm32"))+\)?\)$/,
  },

  {
    id: "true-on-every-host",
    class: "A",
    why: "only asks whether the target is wasm, which no build of the image is",
    kind: ["rust-cfg"],
    text: /^cfg!?\((not\()?target_(family = "wasm"|arch = "wasm32")\)?\)$/,
  },
  {
    id: "callback-calling-convention",
    class: "C",
    why: "the calling convention of a function that Windows x64 or C++ compiled for it calls",
    kind: ["rust-cfg"],
    text: /all\(windows, target_arch = "x86_64"\)/,
  },

  // ── does not apply to the image ─────────────────────────────────────────────────────────────────────────
  {
    id: "crash-handler",
    class: "D",
    why: "crash handler: stack walking, report formats and handlers per OS; the image has the Linux one",
    file: /^src\/crash_handler\//,
  },
  {
    id: "native-addons",
    class: "D",
    why: "N-API, V8 API and process.dlopen: native addons cannot be loaded into a static image",
    file: /^src\/(runtime\/napi\/|jsc\/bindings\/(v8\/|napi|node_api|NodeAddon|DLHandleMap))|^src\/jsc\/bindings\/.*[Nn]api/,
  },
  {
    id: "ffi-tinycc",
    class: "D",
    why: "bun:ffi and tinycc are off in the image (no loader, no JIT C compiler)",
    file: /^src\/(runtime\/ffi\/|tcc_sys\/|jsc\/bindings\/(ffi|FFI|JSFFI))/,
  },
  {
    id: "vendored-libuv-headers",
    class: "D",
    why: "copy of libuv's headers and the stubs of its functions for POSIX builds of native addons",
    file: /^src\/jsc\/bindings\/(libuv\/|uv-posix-)/,
  },
  {
    id: "self-upgrade",
    class: "D",
    why: "bun upgrade replaces a per-OS executable: the portable image is one file for every OS",
    file: /^src\/runtime\/cli\/upgrade_command\.rs$/,
  },
  {
    id: "webview-and-secrets",
    class: "D",
    why: "loads a library of the OS when it runs (WebKit, Chrome, libsecret, Keychain, Credential Manager)",
    file: /^src\/(runtime\/webview\/|jsc\/bindings\/(webview\/|Secrets|JSSecrets|.*WebView))/,
  },
  {
    id: "perf-tracing",
    class: "D",
    why: "tracing and profiling hooks of one OS (ETW, os_signpost, perf): tools of a developer, per OS",
    file: /^src\/perf\//,
  },
  {
    id: "executable-formats",
    class: "A",
    why: "writers of PE, Mach-O and ELF files for bun build --compile: chosen by the target, not by the host",
    file: /^src\/exe_format\//,
  },

  // ── JavaScript can see it: single files and constructs ─────────────────────────────────────────────────
  {
    id: "path-constants-left",
    class: "B",
    why: "SEP, SEP_STR, DELIMITER or NODE_MODULES_NEEDLE in a constant item: still the flavour of Linux",
    kind: ["rust-const"],
    text: /^(SEP|SEP_STR|DELIMITER|NODE_MODULES_NEEDLE|Platform::AUTO)$/,
    // Not the files that define the constants, and not the two that have a constant of their own by that name.
    file: /^src\/(?!paths\/lib\.rs|bun_alloc\/lib\.rs|bun_core\/|sys\/lib\.rs|runtime\/test_runner\/ScopeFunctions\.rs)/,
  },
  {
    id: "own-constant-of-that-name",
    class: "A",
    why: "a constant of the file that has the name of a path constant (a separator of NT paths, of test names)",
    kind: ["rust-const"],
    text: /^(SEP|SEP_STR|DELIMITER)$/,
    file: /^src\/(sys\/lib\.rs|runtime\/test_runner\/ScopeFunctions\.rs)$/,
  },
  {
    id: "path-constants-defined",
    class: "A",
    why: "where the constants of the path flavour are defined, beside the functions that ask the host",
    kind: ["rust-const", "rust-cfg"],
    file: /^src\/(paths\/lib\.rs|bun_alloc\/lib\.rs)$/,
    context: /\b(SEP|SEP_STR|DELIMITER|NODE_MODULES_NEEDLE)\b|cfg!\(windows\) && __B/,
  },
  {
    id: "os-path-unit",
    class: "C",
    why: "the unit of a path for the OS (u16 on Windows): paths of the image are bytes for its C library",
    file: /^src\/(paths|bun_core)\//,
    scope:
      /\b(OSPathChar|OSPathSliceZ|OSPathBuffer|os_path_buffer_pool|WPathBuffer|w_path_buffer_pool|WStr|u16|long_path_prefix|to_w_|NT_|nt_)\b/,
  },
  {
    id: "paths",
    class: "B",
    why: "path logic of bun_paths that is still decided for Linux",
    file: /^src\/paths\//,
  },
  {
    id: "node-path-drive-cwd",
    class: "C",
    why: "path.win32.resolve reads the working directory of a drive from the =C: variables of the Windows environment",
    file: /^src\/runtime\/node\/path\.rs$/,
    scope: /u16_buf|getenv_w|fast_key/,
  },
  {
    id: "node-path",
    class: "B",
    why: "node:path, the rest: the calling convention of the wrappers and the size of path buffers",
    file: /^src\/runtime\/node\/path\.rs$/,
  },
  {
    id: "node-os-values",
    class: "C",
    why: "os.cpus, loadavg, release, version, uptime, totalmem, freemem, networkInterfaces, hostname, priority: read from the OS",
    file: /^src\/runtime\/node\/node_os\.rs$/,
  },
  {
    id: "process-env-names",
    class: "B",
    why: "names and defaults of environment variables per OS",
    file: /^src\/(bun_core\/env_var\.rs|dotenv\/)/,
  },
  {
    id: "which",
    class: "C",
    why: "Bun.which of Windows with wide paths and file attributes; the image has a port of its search for a Windows host",
    file: /^src\/which\//,
  },
  {
    id: "errno-tables",
    class: "A",
    why: "the table of errors per OS: the image has the one of Linux inside, and src/errno/host.rs for JavaScript",
    file: /^src\/errno\//,
  },
  {
    id: "process-object-posix-only",
    class: "B",
    why: "process.getuid and its relatives exist on a Windows host of the image (Node.js does not have them on Windows)",
    file: /^src\/jsc\/bindings\/BunProcess\.cpp$/,
    text: /!OS\(WINDOWS\)/,
    context: /getegid|Process_functiongete|getuid/,
  },
  {
    id: "os-constants",
    class: "R",
    why: "os.constants: the tables of the host for errno, signals and dlopen (the rest of the file is fs, crypto, zlib)",
    file: /^src\/jsc\/bindings\/ProcessBindingConstants\.cpp$/,
    text: /\b(E[A-Z0-9]+|WSAE[A-Z]+|SIG[A-Z0-9]+|RTLD_[A-Z]+)\b/,
  },
  {
    id: "fs-constants",
    class: "B",
    why: "fs.constants (O_*, S_*, UV_FS_*): the numbers of Linux; a program gives them back to fs.open, which expects them",
    file: /^src\/(jsc\/bindings\/ProcessBindingConstants\.cpp|runtime\/node\/node_fs_constant\.rs)$/,
  },
  {
    id: "uv-binding-errno",
    class: "B",
    why: "process.binding('uv') and util.getSystemErrorName: the numbers of Linux",
    file: /^src\/(jsc\/bindings\/ProcessBindingUV\.cpp|runtime\/node\/node_util_binding\.rs|sys\/libuv_error_map\.rs)$/,
  },
  {
    id: "standalone-graph-paths",
    class: "B",
    why: "the paths of the files inside a compiled executable (B:\\~BUN\\ on Windows, /$bunfs/ elsewhere)",
    file: /^src\/(standalone_graph\/|options_types\/standalone_path)/,
  },
  {
    id: "npm-os-cpu",
    class: "B",
    why: "which packages and binaries are for this OS (os and cpu of package.json, optional dependencies)",
    file: /^src\/install\/(npm\.rs|lockfile\/Package\.rs|lockfile\/Package\/Meta\.rs)$|^src\/install_types\//,
  },

  // ── needs a native path: constructs, in any file ───────────────────────────────────────────────────────
  {
    id: "native-interface",
    class: "C",
    why: "guards code of an OS interface (a system call, a handle, libuv, a socket, a terminal, a thread)",
    kind: ["rust-cfg", "rust-const"],
    scope: nativeInterface,
  },

  // ── directories ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "dir-system-calls",
    class: "C",
    why: "system calls and file system semantics: bun's code for each OS",
    file: /^src\/(sys|sys_jsc|libarchive|platform)\//,
  },
  {
    id: "dir-event-loop",
    class: "C",
    why: "event loop, polling, timers and threads per OS",
    file: /^src\/(io|event_loop|threading|watcher|runtime\/timer|bun_core\/thread_id\.rs)|^src\/jsc\/(event_loop|.*[Ee]vent[Ll]oop)/,
  },
  {
    id: "dir-sockets",
    class: "C",
    why: "sockets, DNS and the HTTP client on the socket layer of each OS",
    file: /^(packages\/bun-usockets|packages\/bun-uws|src\/(uws|uws_sys|dns|cares_sys|http|lsquic_sys|runtime\/(socket|dns_jsc|server))\b)/,
  },
  {
    id: "dir-spawn",
    class: "C",
    why: "starting and watching processes, pipes between them, their signals",
    file: /^src\/(spawn|spawn_sys)\/|^src\/runtime\/(ipc|ipc_host)\.rs|^src\/runtime\/api\/bun\//,
  },
  {
    id: "dir-windows-bindings",
    class: "C",
    why: "bindings of Windows and libuv",
    file: /^src\/(windows_sys|libuv_sys)\//,
  },
  {
    id: "dir-console",
    class: "C",
    why: "terminal and console: colours, size, raw mode, progress",
    file: /^src\/bun_core\/(output|tty|Progress|fmt)\.rs$/,
  },
  {
    id: "dir-core-process",
    class: "C",
    why: "file descriptors and handles, threads, clocks, the exit and the memory of the process per OS",
    file: /^src\/bun_core\/(util|Global|debug|lib|ip_address|result|windows_sys|feature_flags)\.rs$|^src\/bun_core\/string\//,
  },
  {
    id: "dir-jsc-native",
    class: "C",
    why: "signals, watchers, the event loop and profilers of the VM per OS",
    file: /^src\/jsc\/(PosixSignalHandle|hot_reloader|lib|BunCPUProfiler|rare_data|web_worker|ipc|Debugger|uuid)\.rs$|^src\/jsc_macros\//,
  },
  {
    id: "dir-sql",
    class: "C",
    why: "database clients on the socket layer",
    file: /^src\/(sql|sql_jsc|valkey)\//,
  },
  {
    id: "dir-allocator",
    class: "A",
    why: "memory of the process: the image asks its C library and mimalloc, the host answers",
    file: /^src\/(bun_alloc|mimalloc_sys)\//,
  },
  {
    id: "dir-shell",
    class: "C",
    why: "the shell: pipes, processes and files of its commands (the names of its variables ask the host)",
    file: /^src\/(runtime\/shell|shell_parser)\//,
  },
  {
    id: "dir-node-fs",
    class: "C",
    why: "node:fs, streams, Blob and file I/O of the runtime",
    file: /^src\/runtime\/(node\/(node_fs|fs_events|win_watcher|path_watcher|dir_iterator|Stat|StatFS|uv_signal|node_net|node_cluster|node_http|types)|webcore)\b/,
  },
  {
    id: "dir-image-codecs",
    class: "D",
    why: "image codecs of the OS (CoreGraphics, WIC): the image has the portable ones",
    file: /^src\/runtime\/image\//,
  },
  {
    id: "dir-resolver-bundler",
    class: "B",
    why: "module resolution and bundling: how a path is read, compared and written",
    file: /^src\/(resolver|bundler|router|glob|js_parser|js_printer|transpiler|sourcemap|options_types|bunfig|patch|md|clap)\//,
  },
  {
    id: "dir-install",
    class: "B",
    why: "package manager: paths, links and shims of binaries, scripts (the file operations themselves are of class C)",
    file: /^src\/(install|install_jsc)\//,
  },
  {
    id: "dir-cli",
    class: "B",
    why: "commands of the CLI: paths, PATH, shells, editors and what is printed",
    file: /^src\/runtime\/cli\//,
  },
  {
    id: "dir-bindings-cpp",
    class: "C",
    why: "C++ of the runtime that calls the OS (process, signals, resource usage, terminal, memory)",
    kind: ["c-preprocessor"],
    file: /^src\/jsc\/bindings\//,
  },
  {
    id: "dir-runtime",
    class: "B",
    why: "runtime API that JavaScript sees",
    file: /^src\/(runtime|jsc|analytics|bun_core)\//,
  },
  {
    id: "js-platform",
    class: "B",
    why: "process.platform of a built-in module, a constant of the bundle",
    kind: ["js-platform"],
  },
];
