use std::collections::HashMap;

use super::Stage::{Fragment, Vertex};
use super::*;

const LIMITS: Limits = Limits {
    vertex_attributes: 16,
    uniform_vectors: [256; 2],
    texture_units: [16; 2],
    combined_texture_units: 32,
    draw_buffers: 4,
    dual_source_draw_buffers: 1,
    varying_vectors: 8,
    stage_vectors: [8; 2],
    texel_offsets: [-8, 7],
    distances: [8; 3],
    samples: 4,
    uniform_blocks: [12; 2],
    combined_uniform_blocks: 24,
    uniform_block_size: 1 << 16,
    separate_feedback_attributes: 4,
    interleaved_feedback_components: 64,
};
const ES3: &str = "#version 300 es\nprecision highp float;";
const EMPTY: &str = "void main(){}";

type Outcome<T> = std::result::Result<T, String>;

/// With as much stack as the thread of a context has.
fn on_thread<T: Send>(run: impl FnOnce() -> T + Send) -> T {
    std::thread::scope(|scope| {
        std::thread::Builder::new()
            .stack_size(8 << 20)
            .spawn_scoped(scope, run)
            .unwrap()
            .join()
            .unwrap()
    })
}

fn shader(stage: Stage, source: &str) -> Outcome<Shader> {
    compile(
        stage,
        source,
        &Options {
            is_webgl2: source.starts_with("#version 300"),
            extensions: !0,
            limits: &LIMITS,
        },
    )
}

fn printed(stage: Stage, source: &str) -> Outcome<String> {
    on_thread(|| shader(stage, source).map(|it| translate(&it)))
}

fn capturing(vertex: &str, fragment: &str, feedback: &[&str]) -> Outcome<Linked> {
    let feedback: Vec<_> = feedback.iter().map(|it| it.to_string()).collect();
    on_thread(|| {
        link(&Request {
            shaders: [&shader(Vertex, vertex)?, &shader(Fragment, fragment)?],
            attribute_locations: &HashMap::new(),
            feedback: &feedback,
            is_feedback_separate: false,
            limits: &LIMITS,
        })
    })
}

fn linked(vertex: &str, fragment: &str) -> Outcome<Linked> {
    capturing(vertex, fragment, &[])
}

fn list(count: usize, item: impl Fn(usize) -> String) -> String {
    (0..count).map(item).collect()
}

#[track_caller]
fn assert_refused<T>(outcome: Outcome<T>, reason: &str) {
    let log = outcome.err().expect("it is refused");
    assert!(log.contains(reason), "{log}");
}

#[test]
fn errors_have_the_line_and_the_token() {
    assert_eq!(
        printed(Vertex, "void main() {\n/*\n*/ a = 1;\n}"),
        Err("ERROR: 0:3: 'a' : it is not declared\n".into())
    );
    assert_refused(printed(Vertex, "#line 40\nvoid main() { a; }"), "0:40:");
    assert_refused(
        printed(
            Vertex,
            "#version 300 es\n#define A \\\n 1\nvoid main() { a; }",
        ),
        "0:4:",
    );
}

#[test]
fn macros() {
    let value = |source: &str| {
        printed(
            Vertex,
            &format!("{source}\nvoid main() {{ gl_PointSize = float(X); }}"),
        )
        .map(|it| it.contains("(gl_PointSize=7.0)"))
    };
    for source in [
        "#define X 7",
        "#define F(a, b) (a + b)\n#define X F(F(1, 2), 4)",
        "#define X 1\n#undef X\n#define X 7",
        "#if 1 + 2 * 3 == 7 && defined(GL_ES) && !defined A\n#define X 7\n#else\n#error\n#endif",
        "#if 0\n$\n#elif __VERSION__ == 100\n#define X 7\n#endif",
        "#if 1 || 1 / 0\n#define X 7\n#endif",
        "const int X = 7;\n#define X X",
    ] {
        assert_eq!(value(source), Ok(true), "{source}");
    }
    for (source, reason) in [
        ("#if 1", "#endif"),
        ("#endif", "no #if"),
        ("#if 1 / 0\n#endif", "division"),
        ("#define GL_A", "reserved"),
        ("#define A 1\n#define A 2", "differently"),
        ("#define X(a) a\nX(1,2)", "number"),
        ("#include <a>", "directive"),
    ] {
        assert_refused(value(source), reason);
    }
    assert_refused(
        value(&(list(40, |it| format!("#define A{} A{it} A{it}\n", it + 1)) + "A40")),
        "too much",
    );
}

#[test]
fn what_webgl_does_not_allow() {
    for (source, reason) in [
        ("void main() { while (true) {} }", "for loops"),
        (
            "uniform int n; void main() { for (int i = 0; i < n; i++) {} }",
            "constant bounds",
        ),
        (
            "void main() { for (int i = 0; i < 2; i++) i = 0; }",
            "cannot be written",
        ),
        (
            "uniform int n; void main() { float a[2]; a[n]; }",
            "indices of loops",
        ),
        (
            "uniform int n; uniform sampler2D s[2]; void main() { texture2D(s[n], vec2(0)); }",
            "indices of loops",
        ),
        (
            "struct S { sampler2D t; }; uniform int n; uniform S s[2]; void main() { texture2D(s[n].t, vec2(0)); }",
            "indices of loops",
        ),
        ("void main() { float a[2]; a[2]; }", "index is too large"),
        ("float webgl_a; void main() {}", "reserved"),
        ("void f(); void main() { f(); }", "no body"),
        (
            "void f(); void g() { f(); } void f() { g(); } void main() {}",
            "calls itself",
        ),
        (
            "struct A { int a; }; struct B { A a; }; struct C { B a; }; struct D { C a; }; struct E { D a; }; void main() {}",
            "4 levels",
        ),
        ("void main() { float a[16385]; }", "too much memory"),
        ("void main() { float a = 1; }", "another type"),
        ("void main() { \u{e4}; }", "syntax"),
    ] {
        assert_refused(printed(Vertex, source), reason);
    }
    assert_refused(printed(Fragment, "float a; void main() {}"), "precision");
    assert_refused(
        printed(
            Vertex,
            &format!("float {}; void main() {{}}", "a".repeat(257)),
        ),
        "too many characters",
    );
    assert!(
        printed(
            Vertex,
            &format!(
                "// \u{e4}\nfloat {}; uniform vec4 u[2]; uniform int n; void main() {{ u[n]; }}",
                "a".repeat(256)
            )
        )
        .is_ok()
    );
}

#[test]
fn constants_are_folded_without_traps() {
    for (expression, expected) in [
        ("1 / 0", None),
        ("-2147483648 / -1", None),
        ("1 << 32", None),
        ("2147483647 + 1", Some("int(2147483648u)")),
        ("int(1e30)", None),
        ("ivec2(3, 4).yx.x * 2", Some("8")),
        ("int[](1, 2, 3).length()", Some("3")),
        ("int(determinant(mat2(2)))", Some("4")),
    ] {
        let text = printed(
            Vertex,
            &format!("{ES3} flat out int a; void main() {{ a = {expression}; }}"),
        )
        .unwrap();
        assert!(
            expected.is_none_or(|it| text.contains(&format!("={it});"))),
            "{expression}: {text}"
        );
    }
}

#[test]
fn nothing_is_left_undefined() {
    let source = "uniform int secret; uniform float f; out vec2 color; float global; void set(out float a) {} int lost() { if (secret > 0) return 1; }
        void main() { float a[3]; vec4 v; mat2 m; int i = secret; color.x = a[i] + v[i] + m[i][i] + global + float(i / i + i % i + (i << i) + int(f) + lost()); while (i > 0) {} do {} while (i > 0); for (int k = 0; k < 9; k++) {} set(global); }";
    let text = printed(Fragment, &format!("{ES3}{source}")).unwrap();
    for name in ["secret", "color", "global", "set", "lost"] {
        assert!(!text.contains(name), "{name}: {text}");
    }
    let count = |part| text.matches(part).count();
    assert_eq!(
        [
            count(",0,2)]"),
            count(",0,3)]"),
            count(",0,1)]"),
            count("(c+=256u)!=0u"),
            count("&31)"),
            count("q(int("),
            count("w(int("),
            count(",-2147483648.,2147483520.)"),
            count("return r;"),
            count(",0,1);")
        ],
        [1, 1, 2, 2, 1, 1, 1, 1, 1, 1],
        "{text}"
    );
    assert!(
        text.contains("=float[3](0.0,0.0,0.0);")
            && text.contains("=vec4(0.0);")
            && text.contains("=mat2(0.0);"),
        "{text}"
    );
}

#[test]
fn what_is_too_deep_or_too_large_is_refused() {
    let in_main = |body: String| format!("void main() {{ {body} }}");
    let samplers = "uniform sampler2D s[65536]; void main() { for (int i = 0; i < 1; i++) texture2D(s[A8], vec2(0)); }";
    let takes_samplers = format!(
        "uniform sampler2D s[1]; float f({}float x) {{ return x; }}",
        list(255, |it| format!("sampler2D a{it},"))
    );
    let nested = list(9, |it| {
        format!("void f{}() {{ {} f{it}(); }}", it + 1, "if (u)".repeat(250))
    });
    for source in [
        in_main("(".repeat(50_000) + "1"),
        in_main("{".repeat(50_000)),
        in_main("-".repeat(50_001) + "1;"),
        in_main("float a;".to_owned() + &"a=".repeat(50_000) + "1.;"),
        in_main("float a; a".to_owned() + &"+a".repeat(50_000) + ";"),
        in_main("vec2(1.)".to_owned() + &".xy".repeat(200_000) + "++;"),
        "#define A0 i\n".to_owned()
            + &list(8, |it| format!("#define A{} (A{it}+A{it})\n", it + 1))
            + samplers,
        takes_samplers
            + &in_main(
                "for (int i = 0; i < 1; i++)".to_owned()
                    + &("f(".to_owned() + &"s[i],".repeat(255)).repeat(9)
                    + "1."
                    + &")".repeat(9)
                    + ";",
            ),
        "uniform sampler2D s[8];".to_owned()
            + &in_main(
                "for (int i = 0; i < 1; i++)".to_owned()
                    + &"texture2D(s[i], ".repeat(20)
                    + "vec2(0)"
                    + &").xy".repeat(20)
                    + ";",
            ),
        "uniform bool u; void f0() {}".to_owned() + &nested + "void main() { f9(); }",
        "void f0() {}".to_owned()
            + &list(40, |it| {
                format!("void f{}() {{ f{it}(); f{it}(); }}", it + 1)
            })
            + "void main() { f40(); }",
    ] {
        assert!(printed(Vertex, &source).is_err(), "{}", &source[..60]);
    }
}

#[test]
fn what_is_deep_but_allowed_is_printed() {
    let calls = format!(
        "uniform sampler2D s[1]; float f(sampler2D a, float x) {{ return x; }} void main() {{ for (int i = 0; i < 1; i++) gl_PointSize = {}1.{}; }}",
        "f(s[i],".repeat(120),
        ")".repeat(120)
    );
    let blocks = format!(
        "uniform bool u; void main() {{ {} gl_PointSize = 1.; }}",
        "if (u)".repeat(250)
    );
    let sums = format!(
        "uniform float u; void main() {{ gl_PointSize = u{}; }}",
        "+u".repeat(250)
    );
    for source in [calls, blocks, sums] {
        assert!(linked(&source, EMPTY).is_ok());
    }
}

#[test]
fn linking_takes_limited_time_and_memory() {
    let fields = |of: &str, name: &str| list(32, |it| format!("{of} {name}{it};"));
    let structs = |name| {
        format!(
            "struct A{{{}}};struct B{{{}}};struct C{{{}}};struct D{{{}}};",
            fields("int", name),
            fields("A", name),
            fields("B", name),
            fields("C", name)
        )
    };
    let source = format!(
        "{}uniform D u{};{EMPTY}",
        structs("m"),
        list(20_000, |it| format!(",u{it}"))
    );
    assert!(linked(&source, &source).is_ok());
    let name = "n".repeat(1000);
    let blocks = format!(
        "{ES3}struct A{{float {name};}};struct B{{A {name}[64];}};struct C{{B {name}[64];}};{}{EMPTY}",
        list(12, |it| format!("uniform U{it}{{C {name}{it};}};"))
    );
    assert_refused(linked(&blocks, &format!("{ES3}{EMPTY}")), "too long");
}

#[test]
fn what_does_not_link() {
    for (vertex, fragment, reason) in [
        (EMPTY, "#version 300 es\nvoid main(){}", "versions"),
        (
            EMPTY,
            "varying lowp float a; void main() { a; }",
            "no such output",
        ),
        (
            "varying vec2 a; void main() {}",
            "varying lowp float a; void main() {}",
            "disagree",
        ),
        (
            "uniform vec2 a; void main() {}",
            "uniform lowp float a; void main() {}",
            "disagree",
        ),
        (
            "uniform highp float a; void main() { a; }",
            "uniform lowp float a; void main() { a; }",
            "disagree",
        ),
        (
            "struct S { int a; }; uniform S s; void main() {}",
            "struct S { int b; }; uniform S s; void main() {}",
            "disagree",
        ),
        (
            "uniform vec4 a[257]; void main() { a[0]; }",
            EMPTY,
            "do not fit",
        ),
        (
            "uniform sampler2D a[17]; void main() { texture2D(a[0], vec2(0)); }",
            EMPTY,
            "samplers",
        ),
        (
            "varying vec4 a[9]; void main() {}",
            "varying lowp vec4 a[9]; void main() { a[0]; }",
            "do not fit",
        ),
        (
            "attribute mat4 a, b, c, d, e; void main() { a; b; c; d; e; }",
            EMPTY,
            "location",
        ),
    ] {
        assert_refused(linked(vertex, fragment), reason);
    }
    assert!(
        linked(
            "varying vec3 a[8]; varying float b[8]; void main() {}",
            "varying lowp vec3 a[8]; varying lowp float b[8]; void main() { a[0]; b[0]; }"
        )
        .is_ok()
    );
}

#[test]
fn members_of_blocks_are_where_std140_puts_them() {
    let block = "struct S { float a; vec2 b; }; uniform U { float a; vec3 b; float c; float d[2]; layout(row_major) mat2x3 e; S f[2]; bool g; } u;";
    let it = linked(&format!("{ES3}{block}{EMPTY}"), &format!("{ES3}{EMPTY}")).unwrap();
    let members: Vec<_> = it
        .uniforms
        .iter()
        .map(|it| (&*it.name, it.offset))
        .collect();
    assert_eq!(
        members,
        [
            ("U.a", 0),
            ("U.b", 16),
            ("U.c", 28),
            ("U.d[0]", 32),
            ("U.e", 64),
            ("U.f[0].a", 112),
            ("U.f[0].b", 120),
            ("U.f[1].a", 128),
            ("U.f[1].b", 136),
            ("U.g", 144)
        ]
    );
    assert_eq!(it.blocks[0].size, 160);
}

#[test]
fn what_is_captured() {
    let (vertex, fragment) = (
        format!(
            "{ES3} out float a[2]; out vec4 b[16]; void unused() {{ gl_PointSize = 1.; }} {EMPTY}"
        ),
        format!("{ES3}{EMPTY}"),
    );
    let it = capturing(&vertex, &fragment, &["a[+1]", "a[00]"]).unwrap();
    assert!(
        it.feedback[0].native_name.ends_with("[1]") && it.feedback[1].native_name.ends_with("[0]")
    );
    for (names, reason) in [
        (&["a[2]"][..], "no such"),
        (&["gl_PointSize"], "no such"),
        (&["a", "a[0]"], "twice"),
        (&["a", "b"], "too much"),
    ] {
        assert_refused(capturing(&vertex, &fragment, names), reason);
    }
}

#[test]
fn all_draw_buffers_are_written() {
    let colors = |source: &str| {
        linked(EMPTY, source).map(|it| {
            (
                it.outputs[0].size,
                it.sources.concat().matches("out vec4 ").count(),
            )
        })
    };
    assert_eq!(
        colors("void main() { gl_FragData[0] = vec4(1); }"),
        Ok((1, 1))
    );
    assert_eq!(
        colors(
            "#extension GL_EXT_draw_buffers : require\nvoid main() { gl_FragData[0] = vec4(1); }"
        ),
        Ok((4, 4))
    );
    assert_eq!(
        colors("#extension GL_EXT_draw_buffers : require\nvoid main() { gl_FragColor = vec4(1); }"),
        Ok((4, 4))
    );
}
