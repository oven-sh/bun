#[derive(Clone, Copy)]
struct CssModuleExport<'a> {
    name: &'a [u8],
}

struct ToCssResult {
    exports: Option<CssModuleExport<'static>>,
}

fn erase_to_static<'a>(export: CssModuleExport<'a>) -> CssModuleExport<'static> {
    // Mirrors css_parser.rs:2718/2723: lifetime-only transmute from an arena
    // borrow to the public result's 'static placeholder.
    unsafe { core::mem::transmute::<CssModuleExport<'a>, CssModuleExport<'static>>(export) }
}

fn make_result() -> ToCssResult {
    let arena_backing = Vec::from(b"class_name".as_slice());
    let export = CssModuleExport {
        name: arena_backing.as_slice(),
    };
    let result = ToCssResult {
        exports: Some(erase_to_static(export)),
    };
    drop(arena_backing);
    result
}

fn main() {
    let result = make_result();
    let export = result.exports.unwrap();
    // Safe Rust read through the public 'static-typed field after the backing
    // arena/vector is gone. Miri should report use-after-free.
    std::hint::black_box(export.name[0]);
}
