#[path = "model_v3.rs"]
mod model;
use model::*;
fn main() {
    let arena = Arena { bytes: core::cell::Cell::new(0) };
    for text in std::env::args().skip(1) {
        let mut p: P<'_, true> = P { side: None, lexer: Lexer { contents: text.as_bytes(), current: 0, start: 0, end: 0, token: T::Eof, has_newline_before: false, is_log_disabled: false, identifier: b"", errors: 0 }, arena: &arena, depth: 0, names: Vec::new() };
        #[cfg(p2)]
        {
            match parse_type_only(&mut p) {
                Ok(node) => {
                    let mut s = String::new();
                    dump(&node, 1, &mut s);
                    println!("== {text:?} stopped at {}\n{s}", p.lexer.start);
                }
                Err(_) => println!("== {text:?} ERROR"),
            }
        }
        let mut sum = 0usize;
        let mut q: P<'_, true> = P { side: None, lexer: Lexer { contents: text.as_bytes(), current: 0, start: 0, end: 0, token: T::Eof, has_newline_before: false, is_log_disabled: false, identifier: b"", errors: 0 }, arena: &arena, depth: 0, names: Vec::new() };
        let r = transpile(&mut q, text.len() % 2 == 0, &mut sum);
        println!("transpile {} {}", r.is_ok(), sum);
    }
}
