use std::env::var;
use std::process::Command;

const FRAMEWORKS: &str = "AppKit ApplicationServices Carbon CoreFoundation CoreGraphics CoreServices CoreText CoreVideo \
    Foundation IOKit IOSurface Metal QuartzCore Security ServiceManagement UserNotifications";

fn main() {
    println!("cargo::rerun-if-changed=src/platform/macos");
    if var("CARGO_CFG_TARGET_OS").unwrap() != "macos" {
        return;
    }
    let (target, out) = (var("TARGET").unwrap(), var("OUT_DIR").unwrap());
    let compiler = var(format!("CC_{}", target.replace('-', "_")))
        .or(var("CC"))
        .unwrap_or("clang".into());
    let architecture = if target.starts_with("aarch64") {
        "arm64"
    } else {
        "x86_64"
    };
    let compile = |name: &str| {
        let object = format!("{out}/{name}.o");
        println!("cargo::rustc-link-arg-cdylib={object}");
        Command::new(&compiler)
            .arg(format!("--target={architecture}-apple-macos13"))
            .args([
                "-c",
                "-Os",
                "-fobjc-arc",
                "-fobjc-arc-exceptions",
                "-fvisibility=hidden",
                "-Wall",
            ])
            .args([
                "-Wno-unguarded-availability-new",
                "-Wno-multichar",
                "-o",
                &object,
            ])
            .arg(format!("src/platform/macos/{name}.m"))
            .spawn()
            .expect("could not run the compiler")
    };
    for mut compiler in [
        "accessibility",
        "app",
        "dialog",
        "layers",
        "menu",
        "system",
        "text",
        "window",
    ]
    .map(compile)
    {
        assert!(compiler.wait().unwrap().success());
    }
    FRAMEWORKS
        .split(' ')
        .for_each(|name| println!("cargo::rustc-link-lib=framework={name}"));
    println!("cargo::rustc-link-lib=objc");
}
