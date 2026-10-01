// A failed link lists every missing native symbol, not only the first twenty.
fn main() {
    println!("cargo:rustc-link-arg-bins=-Wl,--error-limit=0");
}
