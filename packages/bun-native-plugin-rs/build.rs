use std::path::PathBuf;

fn main() {
    println!("cargo:rustc-link-search=./headers");

    let bindings = bindgen::Builder::default()
        .header("wrapper.h")
        // Add absolute path to headers directory
        .clang_arg("-I./headers")
        .parse_callbacks(Box::new(bindgen::CargoCallbacks))
        .rustified_enum("BunLogLevel")
        .rustified_enum("BunLoader")
        .generate()
        .expect("Unable to generate bindings");

    let out_path = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    bindings
        .write_to_file(out_path.join("bindings.rs"))
        .expect("Couldn't write bindings!");
}
