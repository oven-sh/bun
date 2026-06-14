fn main() {
    let buf: Vec<u8> = b"https://example.com/path".to_vec();
    let base = buf.as_ptr() as usize;
    let offset = 8usize;
    let p = (base + offset) as *const u8;
    let _b = unsafe { p.read() };
}

