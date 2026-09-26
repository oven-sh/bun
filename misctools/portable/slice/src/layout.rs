//! The layout of the bindings as the image has it, for the comparison with what the headers of Windows
//! and of libuv say (misctools/portable/bindings).

use crate::json::Report;
use crate::layout_generated;

pub fn print() -> bool {
    let mut report = Report::new();
    report.raw(b"{\"source\":\"image\",\"types\":{");
    layout_generated::types(&mut report);
    report.raw(b"},\"constants\":{");
    layout_generated::constants(&mut report);
    report.raw(b"}}\n");
    report.print()
}
