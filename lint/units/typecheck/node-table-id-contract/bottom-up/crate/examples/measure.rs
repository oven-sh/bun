//! Scratch tool, not part of the crate: time and memory of the node table for dumps of TypeScript.
//! usage: measure <file with one dump path per line> [rounds]
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_macros,
    clippy::disallowed_types
)]
use bun_typecheck_proto::ast::file::{File, IdAllocator};
use bun_typecheck_proto::ast::kind_generated::Kind;
use bun_typecheck_proto::ast::open::Open;
use bun_typecheck_proto::ast::program::Program;
use bun_typecheck_proto::ast::reader::Ast;
use bun_typecheck_proto::bindprobe::{BindStats, bind_probe};
use bun_typecheck_proto::testimport::{ImportStats, import_dump};
use bun_typecheck_proto::tscore::ids::NodeId;
use bun_typecheck_proto::tscore::stable::Arena;
use std::sync::Arc;
use std::time::Instant;

fn rss_kb(field: &str) -> u64 {
    let status = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    for line in status.split('\n') {
        if let Some(rest) = line.strip_prefix(field) {
            return rest
                .trim()
                .trim_end_matches("kB")
                .trim()
                .parse()
                .unwrap_or(0);
        }
    }
    0
}

fn ms(ns: u64) -> f64 {
    ns as f64 / 1e6
}

// Every node of every file of a program: the kind, the parent and the children of each.
fn walk(a: Ast<'_>, files: &[Arc<File>]) -> (u64, u64) {
    let mut nodes = 0u64;
    let mut identifiers = 0u64;
    let mut stack: Vec<NodeId> = Vec::new();
    for file in files {
        stack.push(file.source_file.root);
        while let Some(node) = stack.pop() {
            nodes += 1;
            if a.kind(node) == Kind::Identifier && !a.parent(node).is_nil() {
                identifiers += u64::from(!a.as_identifier(node).text.is_empty());
            }
            stack.extend(a.jsdoc(node).iter());
            stack.extend(a.iter_children(node));
        }
    }
    (nodes, identifiers)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let list = std::fs::read_to_string(&args[1]).expect("list file");
    let rounds: usize = args.get(2).and_then(|r| r.parse().ok()).unwrap_or(1);
    let paths: Vec<&str> = list.split('\n').filter(|line| !line.is_empty()).collect();
    for round in 0..rounds {
        let rss_start = rss_kb("VmRSS:");
        let ids = IdAllocator::new();
        let mut stats = ImportStats::default();
        let mut json_bytes = 0usize;
        let mut read_ns = 0u64;
        let mut unbound: Vec<File> = Vec::new();
        for path in &paths {
            let started = Instant::now();
            let bytes = std::fs::read(path).expect("dump");
            read_ns += started.elapsed().as_nanos() as u64;
            json_bytes += bytes.len();
            unbound.extend(import_dump(&bytes, &ids, &mut stats).expect("import"));
        }
        let syntax_bytes: usize = unbound.iter().map(File::heap_bytes).sum();
        let rss_parsed = rss_kb("VmRSS:");

        let mut bind = BindStats::default();
        let mut bind_ns = 0u64;
        let mut publish_ns = 0u64;
        let mut open_bytes = 0usize;
        for file in &unbound {
            let root = file.source_file.root;
            let started = Instant::now();
            let mut probe_ns = 0u64;
            file.bind_once(&ids, |a| {
                let probe_started = Instant::now();
                let s = bind_probe(a, root);
                probe_ns = probe_started.elapsed().as_nanos() as u64;
                assert_eq!(a.open().faults.first(), None);
                open_bytes += a.open().arena.allocated_bytes();
                bind.nodes += s.nodes;
                bind.symbols += s.symbols;
                bind.declarations += s.declarations;
                bind.tables += s.tables;
                bind.flow_nodes += s.flow_nodes;
            });
            bind_ns += probe_ns;
            publish_ns += (started.elapsed().as_nanos() as u64).saturating_sub(probe_ns);
        }
        let files: Vec<Arc<File>> = unbound.into_iter().map(Arc::new).collect();
        let total_bytes: usize = files.iter().map(|file| file.heap_bytes()).sum();
        let rss_bound = rss_kb("VmRSS:");
        let nodes: u32 = files.iter().map(|file| file.node_count()).sum();
        let slots: u32 = files.iter().map(|file| file.slot_count()).sum();
        let lates: u32 = files.iter().map(|file| file.late_count()).sum();
        let lists: u32 = files.iter().map(|file| file.list_count()).sum();

        // The first program: every file, in the order of the list.
        let started = Instant::now();
        let first = Program::new(files.iter().map(Arc::clone).collect());
        let frozen = first.frozen().expect("page table");
        let first_ns = started.elapsed().as_nanos() as u64;
        let arena = Arena::new();
        let open = Open::new(&arena, &ids);
        let a = Ast::new(&frozen, &open);
        let started = Instant::now();
        let (walked, identifiers) = walk(a, first.files());
        let walk_ns = started.elapsed().as_nanos() as u64;
        let pages = frozen.page_count();

        // A second program that shares the files: the other order, and every second file only.
        let started = Instant::now();
        let second = Program::new(files.iter().rev().step_by(2).map(Arc::clone).collect());
        let second_frozen = second.frozen().expect("page table");
        let second_ns = started.elapsed().as_nanos() as u64;
        let second_open = Open::new(&arena, &ids);
        let b = Ast::new(&second_frozen, &second_open);
        let started = Instant::now();
        let (second_walked, _) = walk(b, second.files());
        let second_walk_ns = started.elapsed().as_nanos() as u64;
        let rss_end = rss_kb("VmRSS:");

        println!(
            "round {round}: files {} dump bytes {json_bytes} dump nodes {} nodes in tables {nodes} made {}",
            paths.len(),
            stats.dump_nodes,
            stats.made_nodes
        );
        println!(
            "  unknown kinds {} unmapped children {} lists {} attrs {} first {:?}",
            stats.unknown_kinds,
            stats.unmapped_children,
            stats.unmapped_lists,
            stats.unmapped_attrs,
            String::from_utf8_lossy(&stats.first_unmapped)
        );
        let names: Vec<String> = stats
            .unknown_kind_names
            .iter()
            .map(|n| String::from_utf8_lossy(n).into_owned())
            .collect();
        let lost: Vec<String> = stats
            .unmapped
            .iter()
            .map(|(k, n)| format!("{}={n}", String::from_utf8_lossy(k)))
            .collect();
        println!("  kinds of the dump that the port has not: {names:?}; unmapped: {lost:?}");
        println!(
            "  texts in the source {} copied {}",
            stats.source_texts, stats.copied_texts
        );
        println!(
            "  ms: read {:.1} json {:.1} build {:.1} finish {:.1} bind probe {:.1} publish {:.1}",
            ms(read_ns),
            ms(stats.json_ns),
            ms(stats.build_ns),
            ms(stats.finish_ns),
            ms(bind_ns),
            ms(publish_ns)
        );
        println!(
            "  bound: symbols {} declarations {} tables {} flow nodes {}",
            bind.symbols, bind.declarations, bind.tables, bind.flow_nodes
        );
        println!(
            "  heap bytes: syntax {syntax_bytes} with bound data {total_bytes} ({:.1} per node); slots {slots} late fields {lates} lists {lists}; binder arenas {open_bytes}",
            total_bytes as f64 / f64::from(nodes.max(1))
        );
        println!(
            "  rss kB: start {rss_start} parsed {rss_parsed} bound {rss_bound} end {rss_end} peak {}",
            rss_kb("VmHWM:")
        );
        println!("  ids used {} pages {pages}", ids.used());
        println!(
            "  program 1: create {:.3} ms, walk {walked} nodes ({identifiers} identifiers) {:.1} ms",
            ms(first_ns),
            ms(walk_ns)
        );
        println!(
            "  program 2 ({} files, other order): create {:.3} ms, walk {second_walked} nodes {:.1} ms",
            second.files().len(),
            ms(second_ns),
            ms(second_walk_ns)
        );
    }
}
