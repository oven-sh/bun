// Runs the vectors through the Rust prototype and prints what the Go ground truth prints.
use diagproto::ast::diagnostic::{Arg, DiagnosticStore, Diagnostics, DiagnosticsCollection, SourceFiles};
use diagproto::compiler::program::sort_and_deduplicate_diagnostics;
use diagproto::core::{TextRange, compute_ecma_line_starts};
use diagproto::diagnostics::{self, Category, Locale, MessageId};
use diagproto::diagnosticwriter::{FormattingOptions, flatten_diagnostic_message, write_format_diagnostics};
use diagproto::ids::{DiagnosticId, NodeId};
use diagproto::slices::{sort_func, sort_stable_func};
use std::io::{BufRead, Write};

struct TestFile { name: Vec<u8>, text: Vec<u8>, lines: Vec<i32> }
struct TestFiles(Vec<TestFile>);
impl TestFiles {
    fn get(&self, file: NodeId) -> Option<&TestFile> { (file.0 as usize).checked_sub(1).and_then(|i| self.0.get(i)) }
}
impl SourceFiles for TestFiles {
    fn file_name(&self, file: NodeId) -> &[u8] { self.get(file).map_or(b"", |f| &f.name) }
    fn path(&self, file: NodeId) -> &[u8] { self.get(file).map_or(b"", |f| &f.name) }
    fn text(&self, file: NodeId) -> &[u8] { self.get(file).map_or(b"", |f| &f.text) }
    fn ecma_line_map(&self, file: NodeId) -> &[i32] { self.get(file).map_or(&[], |f| &f.lines) }
}
fn unhex(s: &str) -> Vec<u8> {
    if s == "-" { return Vec::new(); }
    (0..s.len() / 2).map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap()).collect()
}
fn enhex(b: &[u8]) -> String {
    if b.is_empty() { return "-".to_string(); }
    b.iter().map(|x| format!("{x:02x}")).collect()
}
fn file_id(i: i64) -> NodeId { if i < 0 { NodeId::NIL } else { NodeId(i as u32 + 1) } }
fn relative(name: &[u8]) -> Vec<u8> {
    if let Some(rest) = name.strip_prefix(b"/src/") { return rest.to_vec(); }
    if name.first() == Some(&b'/') { let mut v = b"..".to_vec(); v.extend_from_slice(name); return v; }
    name.to_vec()
}
fn plain(store: &DiagnosticStore, files: &TestFiles, list: &[DiagnosticId]) -> Vec<u8> {
    let mut out = Vec::new();
    let rel = |name: &[u8]| relative(name);
    let opts = FormattingOptions { locale: Locale::DEFAULT, new_line: b"\n", convert_to_relative_path: &rel };
    write_format_diagnostics(&mut out, Diagnostics { store, files }, list, &opts);
    out
}
fn idx_list(all: &[DiagnosticId], list: &[DiagnosticId]) -> String {
    if list.is_empty() { return "-".to_string(); }
    list.iter().map(|d| all.iter().position(|x| x == d).map_or(-1, |i| i as i64).to_string()).collect::<Vec<_>>().join(",")
}
fn main() {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut w = std::io::BufWriter::new(stdout.lock());
    let mut files = TestFiles(Vec::new());
    let mut store = DiagnosticStore::default();
    let mut all: Vec<DiagnosticId> = Vec::new();
    let mut top: Vec<DiagnosticId> = Vec::new();
    let mut name = String::new();
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        if line.is_empty() { continue; }
        let f: Vec<&str> = line.split(' ').collect();
        let int = |s: &str| s.parse::<i64>().unwrap();
        match f[0] {
            "F" => {
                let text = unhex(f[2]);
                let lines = compute_ecma_line_starts(&text);
                files.0.push(TestFile { name: unhex(f[1]), text, lines });
            }
            "CASE" => { name = f[1].to_string(); all.clear(); top.clear(); store = DiagnosticStore::default(); }
            "D" => {
                let n = int(f[7]) as usize;
                let owned: Vec<(bool, Vec<u8>, i64)> = (0..n).map(|i| { let a = f[8 + i]; if let Some(h) = a.strip_prefix("s:") { (true, unhex(h), 0) } else { (false, Vec::new(), int(&a[2..])) } }).collect();
                let args: Vec<Arg<'_>> = owned.iter().map(|(is_str, s, v)| if *is_str { Arg::Str(s) } else { Arg::Int(*v) }).collect();
                let d = store.new_diagnostic(file_id(int(f[1])), TextRange::new(int(f[2]) as i32, int(f[3]) as i32), MessageId(int(f[4]) as u32), &args);
                let c = int(f[5]);
                if c >= 0 { store[d].set_category(match c { 0 => Category::Warning, 1 => Category::Error, 2 => Category::Suggestion, _ => Category::Message }); }
                if f[6] == "1" { store[d].set_skipped_on_no_emit(); }
                all.push(d);
            }
            "A" => {
                let d = store.new_ad_hoc_diagnostic(file_id(int(f[2])), TextRange::new(int(f[3]) as i32, int(f[4]) as i32), &unhex(f[1]));
                all.push(d);
            }
            "X" => {
                let c = int(f[5]);
                let d = store.new_external_diagnostic(file_id(int(f[1])), TextRange::new(int(f[2]) as i32, int(f[3]) as i32), &unhex(f[4]), match c { 0 => Category::Warning, 1 => Category::Error, 2 => Category::Suggestion, _ => Category::Message }, int(f[6]) as i32, &unhex(f[7]));
                all.push(d);
            }
            "KEY" => {
                let key = MessageId(int(f[1]) as u32).key();
                writeln!(w, "KEY {} {}", f[1], String::from_utf8_lossy(&key)).unwrap();
            }
            "N" => {
                let n = int(f[3]) as usize;
                let owned: Vec<(bool, Vec<u8>, i64)> = (0..n).map(|i| { let a = f[4 + i]; if let Some(h) = a.strip_prefix("s:") { (true, unhex(h), 0) } else { (false, Vec::new(), int(&a[2..])) } }).collect();
                let args: Vec<Arg<'_>> = owned.iter().map(|(is_str, s, v)| if *is_str { Arg::Str(s) } else { Arg::Int(*v) }).collect();
                let ci = int(f[1]);
                let chain = if ci >= 0 { all[ci as usize] } else { DiagnosticId::NIL };
                let d = store.new_diagnostic_chain(chain, MessageId(int(f[2]) as u32), &args);
                all.push(d);
            }
            "CL" => {
                let d = store.clone_diagnostic(all[int(f[1]) as usize]);
                let c = int(f[2]);
                store[d].set_category(match c { 0 => Category::Warning, 1 => Category::Error, 2 => Category::Suggestion, _ => Category::Message });
                all.push(d);
            }
            "C" => { let (p, c) = (all[int(f[1]) as usize], all[int(f[2]) as usize]); store.add_message_chain(p, c); }
            "R" => { let (p, c) = (all[int(f[1]) as usize], all[int(f[2]) as usize]); store.add_related_info(p, c); }
            "TOP" => { for s in &f[1..] { top.push(all[int(s) as usize]); } }
            "END" => {
                writeln!(w, "CASE {name}").unwrap();
                let (mut cmp, mut eq, mut eqn) = (String::new(), String::new(), String::new());
                {
                    let view = Diagnostics { store: &store, files: &files };
                    for &a in &all {
                        for &b in &all {
                            let c = view.compare_diagnostics(a, b);
                            cmp.push(if c < 0 { '<' } else if c > 0 { '>' } else { '=' });
                            eq.push(if view.equal_diagnostics(a, b) { '1' } else { '0' });
                            eqn.push(if view.equal_diagnostics_no_related_info(a, b) { '1' } else { '0' });
                        }
                    }
                    writeln!(w, "CMP {cmp}\nEQ {eq}\nEQN {eqn}").unwrap();
                    for (i, &d) in all.iter().enumerate() {
                        writeln!(w, "FLAT {i} {}", enhex(&flatten_diagnostic_message(view, d, b"\n", Locale::DEFAULT))).unwrap();
                    }
                }
                let mut coll = DiagnosticsCollection::default();
                let mut added = Vec::new();
                for &d in &top {
                    let r = coll.add(Diagnostics { store: &store, files: &files }, d);
                    added.push(all.iter().position(|x| *x == r).map_or(-1, |i| i as i64).to_string());
                }
                writeln!(w, "ADD {}", added.join(",")).unwrap();
                for i in 0..files.0.len() {
                    let list = coll.get_diagnostics_for_file(Diagnostics { store: &store, files: &files }, NodeId(i as u32 + 1));
                    writeln!(w, "FILEDIAGS {i} {}", idx_list(&all, &list)).unwrap();
                }
                let global = coll.get_global_diagnostics(Diagnostics { store: &store, files: &files });
                writeln!(w, "GLOBAL {}", idx_list(&all, &global)).unwrap();
                let every = coll.get_diagnostics(Diagnostics { store: &store, files: &files });
                writeln!(w, "ALL {}", idx_list(&all, &every)).unwrap();
                let mut looked = Vec::new();
                for &d in &all { looked.push(coll.lookup(Diagnostics { store: &store, files: &files }, d)); }
                writeln!(w, "LOOKUP {}", if looked.is_empty() { "-".to_string() } else { looked.iter().map(|d| if d.is_nil() { "-1".to_string() } else { all.iter().position(|x| x == d).map_or(-1, |i| i as i64).to_string() }).collect::<Vec<_>>().join(",") }).unwrap();
                let props: Vec<String> = all.iter().map(|&d| { let x = &store[d]; format!("{}:{}:{}:{}:{}:{}:{}", x.pos(), x.end(), x.code(), x.category() as u8, x.message_chain().len(), x.related_information().len(), if x.file().is_nil() { -1 } else { x.file().0 as i64 - 1 }) }).collect();
                writeln!(w, "PROPS {}", props.join(" ")).unwrap();
                {
                    let view = Diagnostics { store: &store, files: &files };
                    let mut stable = top.clone();
                    sort_stable_func(&mut stable, |a, b| view.compare_diagnostics(a, b));
                    writeln!(w, "STABLE {}", idx_list(&all, &stable)).unwrap();
                    let mut unstable = top.clone();
                    sort_func(&mut unstable, |a, b| view.compare_diagnostics(a, b));
                    writeln!(w, "UNSTABLE {}", idx_list(&all, &unstable)).unwrap();
                }
                let sorted = sort_and_deduplicate_diagnostics(&mut store, &files, &top);
                writeln!(w, "SORTEDIDX {}", idx_list(&all, &sorted)).unwrap();
                writeln!(w, "SORTED {}", enhex(&plain(&store, &files, &sorted))).unwrap();
                writeln!(w, "PLAINTOP {}", enhex(&plain(&store, &files, &top))).unwrap();
                writeln!(w, "END").unwrap();
            }
            "FMT" => {
                let n = int(f[2]) as usize;
                let owned: Vec<Vec<u8>> = (0..n).map(|i| unhex(f[3 + i])).collect();
                let args: Vec<&[u8]> = owned.iter().map(|a| &a[..]).collect();
                let (out, result) = diagnostics::format(&unhex(f[1]), &args);
                match result {
                    Ok(()) => writeln!(w, "FMT {}", enhex(&out)).unwrap(),
                    Err(_) => writeln!(w, "FMT {} INVALID kept={}", enhex(b"PANIC:Invalid formatting placeholder"), enhex(&out)).unwrap(),
                }
            }
            "SORT" => {
                let div = int(f[1]) as isize;
                let xs: Vec<isize> = f[2..].iter().map(|t| int(t) as isize).collect();
                let cmpf = |a: isize, b: isize| a / div - b / div;
                let mut u = xs.clone();
                sort_func(&mut u, cmpf);
                let mut st = xs.clone();
                sort_stable_func(&mut st, cmpf);
                let us: Vec<String> = u.iter().map(|v| v.to_string()).collect();
                let ss: Vec<String> = st.iter().map(|v| v.to_string()).collect();
                let bs: Vec<String> = [-5isize, 0, 7, 16, 100, 1000, 100000].iter().map(|&probe| { let (i, ok) = diagproto::slices::binary_search_func(&st, probe, cmpf); format!("{i}:{ok}") }).collect();
                writeln!(w, "SORT {} | {} | {}", us.join(","), ss.join(","), bs.join(",")).unwrap();
            }
            "LINECOL" => {
                let mut s = DiagnosticStore::default();
                let p = int(f[2]) as i32;
                let d = s.new_diagnostic(file_id(int(f[1])), TextRange::new(p, p), diagnostics::Identifier_expected, &[]);
                writeln!(w, "LINECOL {}", enhex(&plain(&s, &files, &[d]))).unwrap();
            }
            _ => {}
        }
    }
}
