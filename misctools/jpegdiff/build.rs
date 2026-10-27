fn main() {
    println!("cargo:rustc-link-search=native=/root/ref/build");
    println!("cargo:rustc-link-lib=static=tjref");
    println!("cargo:rerun-if-changed=/root/ref/build/libtjref.a");
}
