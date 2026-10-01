// SCRATCH, not delivered: the JavaScript step over every unit of a corpus against the goldens of the Go probe.
include!("/workspace/wt/typecheck/src/typecheck/importer/javascript/tests.rs");

fn mask(line: &[u8]) -> Vec<u8> {
    line.to_vec()
}

#[test]
#[ignore]
fn corpus() {
    let pre = std::env::var("PRE").unwrap_or_else(|_| String::from("/tmp/jsrp/pre"));
    let gold = std::env::var("GOLD").unwrap_or_else(|_| String::from("/tmp/jsdocrp/go-js"));
    let report = std::env::var("REPORT").unwrap_or_else(|_| String::from("/tmp/jsrp/out/report.tsv"));
    let outdir = std::env::var("OUTDIR").unwrap_or_else(|_| String::from("/tmp/jsrp/out/trees"));
    let _ = std::fs::create_dir_all(&outdir);
    let mut names: Vec<String> = std::fs::read_dir(&pre)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| n.ends_with(".tree"))
        .map(|n| n.trim_end_matches(".tree").to_string())
        .collect();
    names.sort();
    let mut rows = String::new();
    let (mut total, mut same_tree, mut same_js, mut same_parse, mut same_clones, mut load_errors, mut faults) = (0, 0, 0, 0, 0, 0, 0);
    for name in &names {
        total += 1;
        let before = std::fs::read(format!("{pre}/{name}.tree")).unwrap();
        let source = std::fs::read(format!("{pre}/{name}.src")).unwrap();
        let Ok(golden) = std::fs::read(format!("{gold}/{name}.tsgo.txt")) else {
            rows.push_str(&format!("{name}\tno-golden\n"));
            continue;
        };
        let outcome = match run(&source, &before, true) {
            Ok(outcome) => outcome,
            Err(error) => {
                load_errors += 1;
                rows.push_str(&format!("{name}\tload-error\t{error}\n"));
                continue;
            }
        };
        let _ = std::fs::write(format!("{outdir}/{name}.tree"), &outcome.tree);
        let expected = tree_of(&golden);
        let actual: Vec<&[u8]> = outcome.tree.as_bytes().split(|b| *b == b'\n').filter(|l| !l.is_empty()).collect();
        let tree_same = expected.len() == actual.len() && expected.iter().zip(actual.iter()).all(|(e, a)| mask(e) == mask(a));
        let first_diff = expected.iter().zip(actual.iter()).position(|(e, a)| e != a).unwrap_or(expected.len().min(actual.len()));
        let js_same = diagnostic_lines("jsDiagnostic", &outcome.js.js_diagnostics) == golden_diagnostic_lines(&golden, b"jsDiagnostic");
        // the parse diagnostics of TypeScript, from the first line of the input
        let head = before.split(|b| *b == b'\n').next().unwrap_or(&[]);
        let mut parse: Vec<ParseDiagnostic> = Vec::new();
        for item in head.strip_prefix(b"parseDiagnostics ").unwrap_or(&[]).split(|b| *b == b' ') {
            let parts: Vec<&[u8]> = item.split(|b| *b == b',').collect();
            if parts.len() != 3 { continue; }
            let (p, e, c) = (parse_int(parts[0]).unwrap() as i32, parse_int(parts[1]).unwrap() as i32, parse_int(parts[2]).unwrap() as u32);
            parse.push(ParseDiagnostic { message: MessageId(c), loc: new_text_range(p, e), args: Vec::new(), related_information: Vec::new() });
        }
        let reparse_count = outcome.js.reparse_diagnostics.len();
        merge_reparse_diagnostics(&mut parse, outcome.js.reparse_diagnostics.clone());
        let mine: Vec<String> = parse.iter().map(|d| format!("diagnostic [{},{}) TS{}", d.loc.pos(), d.loc.end(), d.message.0)).collect();
        let parse_same = mine == golden_diagnostic_lines(&golden, b"diagnostic");
        let golden_clones = golden.split(|b| *b == b'\n').find(|l| l.starts_with(b"counts ")).and_then(|l| {
            let at = l.windows(15).position(|w| w == b"reparsedClones=")?;
            parse_int(&l[at + 15..])
        }).unwrap_or(-1);
        let clones_same = golden_clones == outcome.js.reparsed_clones.len() as i64;
        if tree_same { same_tree += 1; }
        if js_same { same_js += 1; }
        if parse_same { same_parse += 1; }
        if clones_same { same_clones += 1; }
        if outcome.fault_count != 0 { faults += 1; }
        let diff_line = if tree_same { String::new() } else {
            format!("{} | {}", expected.get(first_diff).map(|l| l.escape_ascii().to_string()).unwrap_or_default().trim(), actual.get(first_diff).map(|l| l.escape_ascii().to_string()).unwrap_or_default().trim())
        };
        rows.push_str(&format!("{name}\t{}\t{}\t{}\t{}\tfaults={}\treparse={}\tclones={}/{}\t{}\n", tree_same as u8, js_same as u8, parse_same as u8, clones_same as u8, outcome.fault_count, reparse_count, outcome.js.reparsed_clones.len(), golden_clones, diff_line));
    }
    std::fs::write(&report, rows).unwrap();
    println!("units {total} load-errors {load_errors} tree-same {same_tree} js-diag-same {same_js} parse-diag-same {same_parse} clones-same {same_clones} with-faults {faults}");
}

#[test]
#[ignore]
fn indicators() {
    let pre = std::env::var("PRE").unwrap_or_else(|_| String::from("/tmp/jsrp/pre-all"));
    let gold = std::env::var("GOLD").unwrap_or_else(|_| String::from("/tmp/jsdocrp/go-js"));
    let mut names: Vec<String> = std::fs::read_dir(&pre).unwrap().filter_map(|e| e.ok()).filter_map(|e| e.file_name().into_string().ok()).filter(|n| n.ends_with(".tree")).map(|n| n.trim_end_matches(".tree").to_string()).collect();
    names.sort();
    let (mut same, mut nil_mine, mut wrong, mut reparsed_indicator) = (0, 0, 0, 0);
    for name in &names {
        let before = std::fs::read(format!("{pre}/{name}.tree")).unwrap();
        let source = std::fs::read(format!("{pre}/{name}.src")).unwrap();
        let Ok(golden) = std::fs::read(format!("{gold}/{name}.tsgo.txt")) else { continue };
        let mut builder = FileBuilder::new(&source);
        let Ok(root) = load_tree(&mut builder, &before) else { continue };
        let js = convert_javascript_file(&mut builder, root);
        let s = js.external_module_indicator_statement;
        let mine = if s.is_nil() { String::from("<nil>") } else { format!("{}[{},{})", builder.kind(s).string(), builder.loc(s).pos(), builder.loc(s).end()) };
        let gline = golden.split(|b| *b == b'\n').find(|l| l.starts_with(b"externalModuleIndicator ")).map(|l| String::from_utf8_lossy(&l[24..]).to_string()).unwrap_or_default();
        if mine == gline { same += 1; if !s.is_nil() && builder.flags(s).intersects(NodeFlags::REPARSED) { reparsed_indicator += 1; println!("reparsed indicator: {name} {mine}"); } }
        else if s.is_nil() { nil_mine += 1; if nil_mine <= 12 { println!("mine nil: {name} golden {gline}"); } }
        else { wrong += 1; println!("WRONG {name}: mine {mine} golden {gline}"); }
    }
    println!("indicator same {same}, mine nil but golden set {nil_mine}, wrong {wrong}, reparsed {reparsed_indicator}");
}
