fn main() {
    let px = [0u8,0,128,255, 255,0,128,255, 0,255,128,255, 255,255,128,255];
    std::fs::write(std::env::args().nth(1).unwrap(), jpegdiff::reference::encode(&px, 2, 2, 80, false, None).unwrap()).unwrap();
}
