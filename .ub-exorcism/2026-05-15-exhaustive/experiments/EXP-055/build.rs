use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let repo = PathBuf::from("/data/projects/bun");
    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR set"));
    let exe = out_dir.join("uv_handle_type_c_layout");

    let cc = env::var_os("CC").unwrap_or_else(|| "cc".into());
    let status = Command::new(&cc)
        .arg("-std=c11")
        .arg("-D_GNU_SOURCE")
        .arg("-I")
        .arg(repo.join("src/jsc/bindings/libuv"))
        .arg("c_handle_type.c")
        .arg("-o")
        .arg(&exe)
        .status()
        .expect("compile libuv handle-type reflector");
    assert!(status.success(), "libuv handle-type reflector failed to compile");

    let output = Command::new(&exe)
        .output()
        .expect("run libuv handle-type reflector");
    assert!(output.status.success(), "libuv handle-type reflector failed to run");
    let stdout = String::from_utf8(output.stdout).expect("C reflector printed utf8");

    let expected = "\
UV_UNKNOWN_HANDLE=0\n\
UV_ASYNC=1\n\
UV_CHECK=2\n\
UV_FS_EVENT=3\n\
UV_FS_POLL=4\n\
UV_HANDLE=5\n\
UV_IDLE=6\n\
UV_NAMED_PIPE=7\n\
UV_POLL=8\n\
UV_PREPARE=9\n\
UV_PROCESS=10\n\
UV_STREAM=11\n\
UV_TCP=12\n\
UV_TIMER=13\n\
UV_TTY=14\n\
UV_UDP=15\n\
UV_SIGNAL=16\n\
UV_FILE=17\n\
UV_HANDLE_TYPE_MAX=18\n";

    assert_eq!(
        stdout, expected,
        "Bun's vendored libuv header no longer matches EXP-055 HandleType constants"
    );
    println!("cargo:warning=EXP-055 libuv C enum constants matched Rust HandleType mirror");
}
