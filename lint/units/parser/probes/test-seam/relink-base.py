#!/usr/bin/env python3
# Links the test binary of bun_js_parser that the base measurement left unlinked (e3566be889, one test that runs
# Parser::init and Parser::parse_only, 46 undefined symbols) with the stand-ins of native_test_shims.rs, and runs it.
# Needs /tmp/parser-probe (the objects and libraries of that measurement) and the log of its failed link.
# usage: python3 relink-base.py /workspace/wt/parser/src/js_parser/native_test_shims.rs [/tmp/seam-relink]
import glob, json, os, re, subprocess, sys

SHIMS = sys.argv[1]
WORK = sys.argv[2] if len(sys.argv) > 2 else "/tmp/seam-relink"
LOG = "/workspace/notes/lint/units/parser/measure/base/logs-b/b9-probe-test-undefined.log"
OBJECTS = "/tmp/parser-probe/target/debug/build/bun_js_parser/bfe8789d0a73d7de/out"
os.makedirs(WORK, exist_ok=True)
os.chdir(WORK)

# Stand-ins of the two crates that the file names: only `Mutex` and one constant.
open("bun_core.rs", "w").write(
    "pub struct Mutex<T>(std::sync::Mutex<T>);\n"
    "impl<T> Mutex<T> {\n"
    "    pub const fn new(value: T) -> Self { Self(std::sync::Mutex::new(value)) }\n"
    "    pub fn lock(&self) -> std::sync::MutexGuard<'_, T> {\n"
    "        self.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner)\n"
    "    }\n"
    "}\n"
)
open("bun_alloc.rs", "w").write("pub mod mimalloc { pub const MI_MAX_ALIGN_SIZE: usize = 16; }\n")
open("root.rs", "w").write(
    "#![allow(non_snake_case)]\n"
    "pub mod Macro { pub type MacroRemapEntry = u8; }\n"
    f'#[path = "{SHIMS}"]\nmod native_test_shims;\n'
)
rustc = ["rustc", "--edition", "2024"]
subprocess.run(rustc + ["--crate-type", "rlib", "--crate-name", "bun_core", "bun_core.rs"], check=True)
subprocess.run(rustc + ["--crate-type", "rlib", "--crate-name", "bun_alloc", "bun_alloc.rs"], check=True)
subprocess.run(
    rustc
    + ["--crate-type", "lib", "--crate-name", "seam_shims", "--emit=obj", "-C", "codegen-units=1", "-o", "shims.o"]
    + ["root.rs", "--extern", "bun_core=libbun_core.rlib", "--extern", "bun_alloc=libbun_alloc.rlib"],
    check=True,
)

line = re.search(r'= note:\s+("/usr/lib/llvm-23/bin/clang\+\+".*)', open(LOG).read()).group(1)
sysroot = subprocess.check_output(["rustc", "--print", "sysroot"]).decode().strip()
args, logged, i = [], re.findall(r'"((?:[^"\\]|\\.)*)"', line), 0
while i < len(logged):
    a = logged[i]
    if a.endswith("symbols.o"):
        pass
    elif a.startswith("<164 object files omitted>"):
        args += sorted(glob.glob(OBJECTS + "/*.rcgu.o")) + [WORK + "/shims.o"]
    elif a == "-L" and "raw-dylibs" in logged[i + 1]:
        i += 1
    elif a == "-o":
        args += ["-o", WORK + "/probe_test"]
        i += 1
    else:
        a = a.replace("<sysroot>", sysroot)
        braces = re.match(r"(.*)/\{(.*)\}\.rlib$", a)
        if braces:
            for pattern in braces.group(2).split(","):
                args += glob.glob(braces.group(1) + "/" + pattern + ".rlib")
        else:
            args.append(a)
    i += 1
link = subprocess.run(args, capture_output=True, text=True)
print("link exit", link.returncode)
print(link.stderr[-4000:])
if link.returncode == 0:
    sys.exit(subprocess.run([WORK + "/probe_test"]).returncode)
