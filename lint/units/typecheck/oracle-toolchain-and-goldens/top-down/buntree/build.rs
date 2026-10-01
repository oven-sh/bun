// Makes the linker list every undefined symbol instead of the first twenty.
fn main() {
    println!("cargo:rustc-link-arg=-Wl,--error-limit=0");
}
