use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let repo = PathBuf::from("/data/projects/bun");
    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR set"));
    let exe = out_dir.join("napi_c_layout");
    let source = PathBuf::from("c_layout.c");

    let cc = env::var_os("CC").unwrap_or_else(|| "cc".into());
    let status = Command::new(&cc)
        .arg("-std=c11")
        .arg("-DNAPI_VERSION=10")
        .arg("-I")
        .arg(repo.join("src/runtime/napi"))
        .arg(&source)
        .arg("-o")
        .arg(&exe)
        .status()
        .expect("compile C N-API layout reflector");
    assert!(status.success(), "C N-API layout reflector failed to compile");

    let output = Command::new(&exe)
        .output()
        .expect("run C N-API layout reflector");
    assert!(output.status.success(), "C N-API layout reflector failed to run");
    let stdout = String::from_utf8(output.stdout).expect("C reflector printed utf8");

    let expected = "\
napi_property_descriptor size=64 align=8 utf8name=0 name=8 method=16 getter=24 setter=32 value=40 attributes=48 data=56\n\
napi_extended_error_info size=24 align=8 error_message=0 engine_reserved=8 engine_error_code=16 error_code=20\n\
napi_type_tag size=16 align=8 lower=0 upper=8\n\
napi_node_version size=24 align=8 major=0 minor=4 patch=8 release=16\n\
napi_module size=72 align=8 nm_version=0 nm_flags=4 nm_filename=8 nm_register_func=16 nm_modname=24 nm_priv=32 reserved=40\n";

    assert_eq!(
        stdout, expected,
        "Bun N-API C headers no longer match EXP-054 expected LP64 layout"
    );
    println!("cargo:warning=EXP-054 C header layout matched expected LP64 N-API constants");
}
