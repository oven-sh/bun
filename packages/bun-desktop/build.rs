use std::collections::BTreeMap;
use std::env::var;
use std::fmt::Write as _;
use std::process::Command;

const PROTOCOL: &str = "../../src/ui/protocol.rs";
const FRAMEWORKS: &str = "Accessibility AppKit ApplicationServices Carbon CoreFoundation CoreGraphics CoreServices CoreText CoreVideo \
    Foundation IOKit IOSurface Metal QuartzCore Security ServiceManagement UserNotifications";

/// Splits at the commas that are not in brackets.
fn members(body: &str) -> Vec<&str> {
    let (mut depth, mut start, mut all) = (0, 0, Vec::new());
    for (at, character) in body.char_indices() {
        match character {
            '{' | '(' | '[' | '<' => depth += 1,
            '}' | ')' | ']' | '>' => depth -= 1,
            ',' if depth == 0 => all.push(body[std::mem::replace(&mut start, at + 1)..at].trim()),
            _ => {}
        }
    }
    all.push(body[start..].trim());
    all.retain(|it| !it.is_empty());
    all
}

fn camel_case(name: &str) -> String {
    let words = name
        .split('_')
        .map(|word| word[..1].to_uppercase() + &word[1..])
        .collect::<String>();
    words[..1].to_lowercase() + &words[1..]
}

/// The C declarations of the types in `protocol.rs`, each after what it contains.
struct Header<'a> {
    /// Whether it is an enum, and what is between the braces.
    declared: BTreeMap<&'a str, (bool, &'a str)>,
    written: Vec<String>,
    text: String,
}

impl Header<'_> {
    fn is_new(&mut self, name: &str) -> bool {
        let is_new = !self.written.iter().any(|it| it == name);
        self.written.push(name.into());
        is_new
    }

    fn field(&mut self, name: &str, rust: &str) -> String {
        format!("{} {};", self.name(rust), camel_case(name))
    }

    fn fields(&mut self, body: &str) -> String {
        let pairs = members(body)
            .into_iter()
            .map(|it| it.trim_start_matches("pub ").split_once(':').unwrap());
        pairs
            .map(|(name, rust)| self.field(name, rust.trim()))
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn name(&mut self, rust: &str) -> String {
        let primitives = [("bool", "bool"), ("f32", "float"), ("f64", "double")];
        if let Some((_, c)) = primitives.iter().find(|it| it.0 == rust) {
            return c.to_string();
        }
        if let Some(bits) = rust.get(1..).filter(|it| it.parse::<u8>().is_ok()) {
            return format!(
                "{}int{bits}_t",
                if rust.starts_with('u') { "u" } else { "" }
            );
        }
        let name = format!("BD{}", rust.replace(|it: char| !it.is_alphanumeric(), ""));
        if !self.is_new(&name) {
            return name;
        }
        let inside = |before: &str| rust.strip_prefix(before).map(|it| &it[..it.len() - 1]);
        let body = if let Some(element) = inside("List<") {
            // It may be what contains the list.
            let is_struct = self
                .declared
                .get(element)
                .is_some_and(|it| !it.0 || it.1.contains(['(', '{']));
            let pointee = if is_struct {
                format!("struct BD{element}")
            } else {
                self.name(element)
            };
            format!("{pointee}* start; size_t length, capacity;")
        } else if let Some(value) = inside("Maybe<") {
            format!("bool has; {} value;", self.name(value))
        } else if let Some((element, length)) = inside("[").and_then(|it| it.split_once("; ")) {
            format!("{} at[{length}];", self.name(element))
        } else if let (true, body) = self.declared[rust] {
            let (mut tags, mut contents) = (String::new(), String::new());
            for variant in members(body) {
                let (tag, rest) =
                    variant.split_at(variant.find([' ', '(']).unwrap_or(variant.len()));
                write!(tags, "{name}{tag}, ").unwrap();
                match rest.trim().split_at_checked(1) {
                    Some(("(", rest)) => contents += &self.field(tag, &rest[..rest.len() - 1]),
                    Some((_, rest)) => write!(
                        contents,
                        "struct {{ {} }} {};",
                        self.fields(&rest[..rest.len() - 1]),
                        camel_case(tag)
                    )
                    .unwrap(),
                    None => {}
                }
            }
            if contents.is_empty() {
                writeln!(self.text, "typedef enum : uint8_t {{ {tags}}} {name};").unwrap();
                return name;
            }
            writeln!(self.text, "typedef enum : uint8_t {{ {tags}}} {name}Tag;").unwrap();
            format!("{name}Tag tag; union {{ {contents} }};")
        } else {
            self.fields(self.declared[rust].1)
        };
        writeln!(self.text, "typedef struct {name} {{ {body} }} {name};").unwrap();
        name
    }
}

fn header(protocol: &str) -> String {
    let code = protocol
        .lines()
        .filter(|it| !it.trim_start().starts_with("//") && !it.trim_start().starts_with("#["));
    let code = code.collect::<Vec<_>>().join("\n");
    let mut declared = BTreeMap::from([
        ("Text", (false, "bytes: List<u8>")),
        ("Rect", (false, "x: f32, y: f32, width: f32, height: f32")),
    ]);
    for (keyword, is_enum) in [
        ("\npub struct ", false),
        ("\npub(crate) struct ", false),
        ("\npub enum ", true),
    ] {
        for (name, rest) in code
            .split(keyword)
            .skip(1)
            .filter_map(|it| it.split_once(" {\n"))
        {
            declared
                .entry(name)
                .or_insert((is_enum, rest.split("\n}").next().unwrap()));
        }
    }
    let mut header = Header {
        declared,
        written: Vec::new(),
        text: String::new(),
    };
    let wanted = "WindowOptions TouchBarItem WindowCommand WindowEvent Display List<BackdropPart> BackdropPart \
        MenuItem SystemCommand FileFilter SystemRequest SystemEvent Reply SystemState Maybe<Application> Preference \
        Maybe<PreferenceValue> PreferenceCommand ClipboardPart Cursor Dragged Question List<List<Text>>";
    wanted.split(' ').for_each(|it| drop(header.name(it)));
    header.text
}

fn main() {
    println!("cargo::rerun-if-changed=src/platform/macos");
    println!("cargo::rerun-if-changed={PROTOCOL}");
    if var("CARGO_CFG_TARGET_OS").unwrap() != "macos" {
        return;
    }
    let (target, out) = (var("TARGET").unwrap(), var("OUT_DIR").unwrap());
    std::fs::write(
        format!("{out}/protocol.h"),
        header(&std::fs::read_to_string(PROTOCOL).unwrap()),
    )
    .unwrap();
    let compiler = var(format!("CC_{}", target.replace('-', "_")))
        .or(var("CC"))
        .unwrap_or("clang".into());
    let architecture = if target.starts_with("aarch64") {
        "arm64"
    } else {
        "x86_64"
    };
    let compile = |name: &str| {
        let object = format!("{out}/{name}.o");
        println!("cargo::rustc-link-arg={object}");
        Command::new(&compiler)
            .arg(format!("--target={architecture}-apple-macos13"))
            .args([
                "-c",
                "-Os",
                "-fobjc-arc",
                "-fobjc-arc-exceptions",
                "-fvisibility=hidden",
                "-Wall",
                "-I",
                &out,
            ])
            .args([
                "-Wno-unguarded-availability-new",
                "-Wno-multichar",
                "-o",
                &object,
            ])
            .arg(format!("src/platform/macos/{name}.m"))
            .spawn()
            .expect("could not run the compiler")
    };
    for mut compiler in [
        "accessibility",
        "app",
        "dialog",
        "layers",
        "menu",
        "system",
        "text",
        "touchbar",
        "vector",
        "window",
    ]
    .map(compile)
    {
        assert!(compiler.wait().unwrap().success());
    }
    FRAMEWORKS
        .split(' ')
        .for_each(|name| println!("cargo::rustc-link-lib=framework={name}"));
    println!("cargo::rustc-link-lib=objc");
}
