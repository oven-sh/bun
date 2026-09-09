//! Throughput benchmark for the XML parser against other Rust and C/C++ parsers.
//! Run via `scripts/bench-json-rust.sh --xml [criterion args]`. Fixtures: every `*.xml` / `*.svg` in
//! `$BUN_XML_BENCH_FIXTURES` (default `bench/xml-corpus/`), plus built-in synthetic documents.
use bun_alloc::Arena as Bump;
use bun_ast as js_ast;
use bun_parsers::xml;
use criterion::{BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};

#[path = "../native_test_shims.rs"]
mod native_test_shims;

unsafe extern "C" {
    #[cfg(pugixml)]
    fn bench_pugixml_parse(data: *const u8, len: usize) -> usize;
    #[cfg(expat)]
    fn bench_expat_parse(data: *const u8, len: usize) -> usize;
    #[cfg(libxml2)]
    fn bench_libxml2_parse(data: *const u8, len: usize) -> usize;
}

fn fixtures() -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    let dir = std::env::var("BUN_XML_BENCH_FIXTURES")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            let mut p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            p.pop();
            p.pop();
            p.push("bench/xml-corpus");
            p
        });
    if let Ok(rd) = std::fs::read_dir(&dir) {
        let mut files: Vec<_> = rd
            .filter_map(|e| {
                let p = e.ok()?.path();
                matches!(p.extension()?.to_str()?, "xml" | "svg").then_some(p)
            })
            .collect();
        files.sort();
        for p in files {
            let name = p.file_stem().unwrap().to_string_lossy().into_owned();
            out.push((name, std::fs::read(&p).unwrap()));
        }
    }
    out.push(("synth-feed".into(), synth_feed()));
    out.push(("synth-records".into(), synth_records()));
    out.push(("synth-soup".into(), synth_soup()));
    out
}

/// Atom-like feed: long text runs, entities, some CDATA (~1 MB).
fn synth_feed() -> Vec<u8> {
    let mut s = String::from(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<feed xmlns=\"http://www.w3.org/2005/Atom\">\n  <title>Example Feed</title>\n",
    );
    let mut i = 0;
    while s.len() < 1_000_000 {
        s.push_str(&format!(
            "  <entry>\n    <title>Entry number {i} &amp; friends</title>\n    <link href=\"http://example.org/2003/12/13/atom{i}\"/>\n    <id>urn:uuid:1225c695-cfb8-4ebb-aaaa-{i:012}</id>\n    <updated>2003-12-13T18:30:02Z</updated>\n    <summary>Some text that goes on for a while, describing entry {i} in enough detail that the text run is realistically long — with an em dash, «quotes», and &lt;escaped&gt; markup.</summary>\n    <content type=\"html\"><![CDATA[<p>Paragraph <b>{i}</b> with <a href=\"#\">links</a> & raw ampersands.</p>]]></content>\n  </entry>\n"
        ));
        i += 1;
    }
    s.push_str("</feed>\n");
    s.into_bytes()
}

/// Data-centric records: many short elements and attributes (~1 MB).
fn synth_records() -> Vec<u8> {
    let mut s = String::from("<records>");
    let mut i = 0;
    while s.len() < 1_000_000 {
        s.push_str(&format!(
            "<r id=\"{i}\" kind=\"k{}\" active=\"true\"><name>Item {i}</name><price currency=\"USD\">{}.99</price><qty>{}</qty><tags><t>a</t><t>b</t><t>c{}</t></tags></r>",
            i % 7,
            i % 100,
            i % 13,
            i % 5
        ));
        i += 1;
    }
    s.push_str("</records>");
    s.into_bytes()
}

/// Markup soup: deep nesting, tiny names, whitespace-only text (~1 MB).
fn synth_soup() -> Vec<u8> {
    let mut s = String::from("<a>\n");
    while s.len() < 1_000_000 {
        for d in 0..12 {
            s.push_str(&"  ".repeat(d + 1));
            s.push_str("<b c=\"d\">\n");
        }
        s.push_str(&"  ".repeat(13));
        s.push_str("<e/><f/><g h=\"i\"/>\n");
        for d in (0..12).rev() {
            s.push_str(&"  ".repeat(d + 1));
            s.push_str("</b>\n");
        }
    }
    s.push_str("</a>\n");
    s.into_bytes()
}

/// `BUN_XML_BENCH_LOOP=impl:fixture:iterations` runs one parser in a plain loop and exits, for
/// `perf stat` (instruction counts are stable where wall time on a shared box is not).
fn maybe_loop() {
    let Ok(spec) = std::env::var("BUN_XML_BENCH_LOOP") else {
        return;
    };
    let mut parts = spec.split(':');
    let (imp, fx, n) = (
        parts.next().unwrap(),
        parts.next().unwrap(),
        parts.next().unwrap().parse::<usize>().unwrap(),
    );
    let (_, contents) = fixtures()
        .into_iter()
        .find(|(name, _)| name == fx)
        .expect("fixture");
    bun_ast::initialize_store();
    let mut bump = Bump::new();
    let start = std::time::Instant::now();
    for _ in 0..n {
        match imp {
            "bun_compact" | "bun_tree" => {
                let _store_scope = js_ast::StoreResetGuard::new();
                let mut log = js_ast::Log::init();
                bump.reset();
                let source = js_ast::Source::init_path_string("fixture.xml", &contents[..]);
                let opts = xml::Options {
                    compact: imp == "bun_compact",
                    encoding: xml::InputEncoding::Bytes,
                };
                let e = xml::XML::parse(&source, &mut log, &bump, opts).expect("parse");
                std::hint::black_box(&e);
            }
            #[cfg(pugixml)]
            "pugixml" => {
                std::hint::black_box(unsafe {
                    bench_pugixml_parse(contents.as_ptr(), contents.len())
                });
            }
            "stage1" => {
                let mut x = bun_parsers::xml_index::StructuralIndex::new(&contents);
                let mut i = 0usize;
                while x.at(i) != contents.len() {
                    i += 1;
                }
                std::hint::black_box(i);
            }
            _ => panic!("unknown impl {imp}"),
        }
    }
    let secs = start.elapsed().as_secs_f64();
    eprintln!(
        "{imp}/{fx}: {n} iterations, {:.1} MiB/s wall",
        (contents.len() * n) as f64 / secs / 1048576.0
    );
    std::process::exit(0);
}

fn bench_xml(c: &mut Criterion) {
    maybe_loop();
    bun_ast::initialize_store();
    let mut group = c.benchmark_group("xml_parse");
    group.sample_size(20);
    for (name, contents) in fixtures() {
        group.throughput(Throughput::Bytes(contents.len() as u64));

        for (id, compact) in [("bun_compact", true), ("bun_tree", false)] {
            group.bench_function(BenchmarkId::new(id, &name), |b| {
                let mut bump = Bump::new();
                b.iter(|| {
                    let _store_scope = js_ast::StoreResetGuard::new();
                    let mut log = js_ast::Log::init();
                    bump.reset();
                    let source = js_ast::Source::init_path_string("fixture.xml", &contents[..]);
                    let opts = xml::Options {
                        compact,
                        encoding: xml::InputEncoding::Bytes,
                    };
                    let e = xml::XML::parse(&source, &mut log, &bump, opts).unwrap_or_else(|_| {
                        panic!(
                            "{name}: {}",
                            log.msgs
                                .first()
                                .map(|m| String::from_utf8_lossy(&m.data.text).into_owned())
                                .unwrap_or_default()
                        )
                    });
                    std::hint::black_box(&e);
                })
            });
        }

        group.bench_function(BenchmarkId::new("stage1_index", &name), |b| {
            b.iter(|| {
                let mut x = bun_parsers::xml_index::StructuralIndex::new(&contents);
                let mut i = 0usize;
                let mut sum = 0usize;
                loop {
                    let p = x.at(i);
                    if p == contents.len() {
                        break;
                    }
                    sum += p;
                    i += 1;
                }
                std::hint::black_box((sum, i))
            })
        });

        // quick-xml: pull parser; touch every event's name/text/attributes (unescaped) so the
        // work is comparable to building values, but build no tree.
        fn quick_xml_run(contents: &[u8]) -> Option<usize> {
            use quick_xml::events::Event;
            let mut reader = quick_xml::Reader::from_reader(contents);
            reader.config_mut().check_end_names = true;
            let mut n = 0usize;
            let mut buf = Vec::new();
            loop {
                match reader.read_event_into(&mut buf).ok()? {
                    Event::Start(e) | Event::Empty(e) => {
                        n += e.name().as_ref().len();
                        for a in e.attributes() {
                            let a = a.ok()?;
                            n += match a.unescape_value() {
                                Ok(v) => v.len(),
                                Err(_) => a.value.len(),
                            };
                        }
                    }
                    Event::Text(t) => n += t.xml10_content().ok()?.len(),
                    Event::GeneralRef(r) => n += r.len(),
                    Event::CData(t) => n += t.len(),
                    Event::End(e) => n += e.name().as_ref().len(),
                    Event::Eof => break,
                    _ => {}
                }
                buf.clear();
            }
            Some(n)
        }
        if quick_xml_run(&contents).is_some() {
            group.bench_function(BenchmarkId::new("quick_xml_events", &name), |b| {
                b.iter(|| std::hint::black_box(quick_xml_run(&contents)))
            });
        }

        // roxmltree: read-only DOM (the closest Rust analogue to what Bun builds).
        if let Ok(text) = std::str::from_utf8(&contents) {
            let opts = roxmltree::ParsingOptions {
                allow_dtd: true,
                ..Default::default()
            };
            if roxmltree::Document::parse_with_options(text, opts).is_ok() {
                group.bench_function(BenchmarkId::new("roxmltree_dom", &name), |b| {
                    b.iter(|| {
                        let doc = roxmltree::Document::parse_with_options(text, opts).unwrap();
                        std::hint::black_box(doc.root_element().children().count())
                    })
                });
            }
        }

        // xml-rs: the classic (slow) pull parser, for scale.
        fn xml_rs_run(contents: &[u8]) -> Option<usize> {
            let mut n = 0usize;
            for ev in xml_rs::EventReader::new(contents) {
                match ev.ok()? {
                    xml_rs::reader::XmlEvent::Characters(t) => n += t.len(),
                    _ => n += 1,
                }
            }
            Some(n)
        }
        if contents.len() <= 1_500_000 && xml_rs_run(&contents).is_some() {
            group.bench_function(BenchmarkId::new("xml_rs_events", &name), |b| {
                b.iter(|| std::hint::black_box(xml_rs_run(&contents)))
            });
        }

        #[cfg(pugixml)]
        if unsafe { bench_pugixml_parse(contents.as_ptr(), contents.len()) } != 0 {
            group.bench_function(BenchmarkId::new("pugixml_dom", &name), |b| {
                b.iter(|| {
                    std::hint::black_box(unsafe {
                        bench_pugixml_parse(contents.as_ptr(), contents.len())
                    })
                })
            });
        }
        #[cfg(expat)]
        if unsafe { bench_expat_parse(contents.as_ptr(), contents.len()) } != 0 {
            group.bench_function(BenchmarkId::new("expat_sax", &name), |b| {
                b.iter(|| {
                    std::hint::black_box(unsafe {
                        bench_expat_parse(contents.as_ptr(), contents.len())
                    })
                })
            });
        }
        #[cfg(libxml2)]
        if unsafe { bench_libxml2_parse(contents.as_ptr(), contents.len()) } != 0 {
            group.bench_function(BenchmarkId::new("libxml2_dom", &name), |b| {
                b.iter(|| {
                    std::hint::black_box(unsafe {
                        bench_libxml2_parse(contents.as_ptr(), contents.len())
                    })
                })
            });
        }
    }
    group.finish();
}

criterion_group!(benches, bench_xml);
criterion_main!(benches);
