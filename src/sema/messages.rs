//! TypeScript's diagnostic messages, by code.
//!
//! `messages.txt` has one `code<tab>category<tab>text` line per message, sorted by code. It's generated from
//! `internal/diagnostics/diagnostics_generated.go` of typescript-go 7.0.2 (Copyright Microsoft Corporation, Apache License 2.0)
//! and isn't edited by hand. Release builds embed it compressed and inflate it when the first message is looked up.

use bun_core::strings;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Category {
    Warning,
    Error,
    Suggestion,
    Message,
}

impl Category {
    /// `Category.Name`
    pub fn name(self) -> &'static str {
        match self {
            Category::Warning => "warning",
            Category::Error => "error",
            Category::Suggestion => "suggestion",
            Category::Message => "message",
        }
    }
}

/// Bytes as text, for the tools that write baselines.
#[cfg(feature = "baselines")]
pub fn text(bytes: &[u8]) -> String {
    bstr::BStr::new(bytes).to_string()
}

/// The category and the text of the message with `code`. `{0}`, `{1}`, ... are placeholders for its
/// arguments.
pub fn message(code: u32) -> Option<(Category, &'static str)> {
    if code > LAST_TYPESCRIPT_MESSAGE {
        let at = OWN_MESSAGES.binary_search_by_key(&code, |m| m.0).ok()?;
        return OWN_MESSAGES.get(at).map(|m| (m.1, m.2));
    }
    static MESSAGES: bun_core::Once<Vec<(u32, Category, &'static str)>> = bun_core::Once::new();
    let messages = MESSAGES.get_or_init(parse);
    let at = messages.binary_search_by_key(&code, |m| m.0).ok()?;
    messages.get(at).map(|m| (m.1, m.2))
}

fn parse() -> Vec<(u32, Category, &'static str)> {
    let bytes: &'static [u8] =
        bun_zstd::embed_compressed!("src/sema/messages.txt", include_bytes!("messages.txt"));
    let all = core::str::from_utf8(bytes).unwrap_or_default();
    let (mut messages, mut start) = (Vec::new(), 0);
    while let Some(len) = strings::index_of_char_usize(&bytes[start..], b'\n') {
        let line = &bytes[start..start + len];
        let digits = line.iter().take_while(|b| b.is_ascii_digit()).count();
        let code = line[..digits]
            .iter()
            .fold(0, |n, b| n * 10 + u32::from(b - b'0'));
        let category = match line.get(digits + 1) {
            Some(b'E') => Category::Error,
            _ => Category::Message,
        };
        if let Some(text) = all.get(start + digits + 3..start + len) {
            messages.push((code, category, text));
        }
        start += len + 1;
    }
    messages
}

/// The greatest code that TypeScript uses.
const LAST_TYPESCRIPT_MESSAGE: u32 = 100000;

/// The messages that TypeScript does not have, sorted by code.
static OWN_MESSAGES: &[(u32, Category, &str)] = &[
    (100009, Category::Warning, "'{0}' has {1} type errors, the first at {2}: it is compiled untyped."),
    (100010, Category::Warning, "'{0}' has {1} type errors, the first at {2}: it is compiled untyped, which costs speed, not correctness."),
    (100011, Category::Warning, "'{0}' is compiled untyped, which costs speed, not correctness: too many types cross between it and untyped code through '{1}' at {2} to analyze."),
    (100012, Category::Error, "This non-null assertion always fails under --aot: the value is always {0}."),
    (100013, Category::Error, "This always throws a TypeError under --aot: {2} expects '{1}' and always gets {0}."),
    (100014, Category::Error, "This always fails under --aot: {0}."),
    (100015, Category::Error, "This always throws a TypeError under --aot: {0}."),
    (100017, Category::Error, "'as {0}' is applied to a value that is always {1}: under --aot the cast converts it or throws, whereas plain JavaScript leaves it unchanged."),
    (100018, Category::Message, "The value comes from {0}."),
    (100019, Category::Warning, "{2} expects '{1}' and always gets {0}: with --aot-type-errors=log the executable logs a record here and continues as plain JavaScript would; any other --aot build fails with TS100013."),
    (100020, Category::Warning, "{0} The 'catch' around it runs instead."),
    (100021, Category::Error, "The typed version of '{0}' in {1} has type errors ({2}), the first at {3}. Fix it, or remove it to compile '{0}' untyped."),
    (100022, Category::Warning, "'{0}' can hold objects that typed code did not create, so every property access through it checks the object first."),
    (100023, Category::Warning, "Class '{0}' has no fixed layout, so its instances are compiled as untyped objects."),
    (100024, Category::Warning, "Class '{0}' leaves declared fields out of its layout, so every access to them is a lookup by name: {1}."),
    (100025, Category::Warning, "'{0}' evaluates source text when the program runs. An --aot executable has no JIT, so that code runs in the interpreter."),
    (100026, Category::Warning, "'{0}' is JavaScript, so it is compiled without types: {1}, {2}% of the program's source text."),
    (100027, Category::Warning, "Class '{0}' extends a class from outside typed code, so it has no fixed layout and its instances are compiled as untyped objects."),
    (100040, Category::Message, "A value of type 'any' or 'unknown' is assigned to it here."),
    (100041, Category::Message, "A value from outside the type system is assigned to it here."),
    (100042, Category::Message, "A value of type '{0}' that typed code did not create is assigned to it here."),
    (100043, Category::Message, "'{0}' is assigned to it here, and can hold such objects itself."),
    (100044, Category::Message, "A value of type '{0}' is cast to it, and '{0}' can hold such objects itself."),
    (100045, Category::Message, "It is declared in a declaration file, so its objects come from code that is not compiled with its types."),
    (100046, Category::Message, "An instance or a method of the class is passed to untyped code."),
    (100047, Category::Message, "JavaScript code of the program receives its objects here and can change their shape."),
    (100048, Category::Message, "'{0}' reaches it through a cast or an untyped value and cannot be converted to it."),
    (100050, Category::Message, "It is declared inside this function, so a new class is created each time the function runs."),
    (100051, Category::Message, "It is declared inside this loop, so a new class is created on every iteration."),
    (100052, Category::Message, "It is declared in the initializer of this field, so a new class is created for every instance."),
    (100053, Category::Message, "It takes its name from a computed property key."),
    (100054, Category::Message, "This decorator can replace the class or its members."),
    (100055, Category::Message, "Its base class '{0}' has no fixed layout."),
    (100056, Category::Message, "This base class is a built-in or comes from JavaScript."),
    (100057, Category::Message, "This constructor can use 'this' or return before 'super()' has returned."),
    (100058, Category::Message, "This call can redefine a property of its instances."),
    (100059, Category::Message, "This tests an object for a private name of the class, and 'this' escapes while an instance is constructed."),
    (100060, Category::Message, "The name of this member is computed and is not a constant, so it could be the name of any field."),
    (100061, Category::Message, "'{0}' is also the name of this method or accessor."),
    (100062, Category::Message, "This base class is not the name of one class declaration."),
];

const _: () = {
    let mut at = 1;
    while at < OWN_MESSAGES.len() {
        assert!(OWN_MESSAGES[at - 1].0 < OWN_MESSAGES[at].0, "OWN_MESSAGES is searched by halves: a code stands twice, or out of its place");
        at += 1;
    }
};

/// `Message.Format`: writes `text` with `{n}` replaced by `args[n]`. A placeholder without an
/// argument is left unchanged.
pub fn format(out: &mut Vec<u8>, text: &str, args: &[impl AsRef<[u8]>]) {
    let mut rest = text.as_bytes();
    while let Some(open) = strings::index_of_char_usize(rest, b'{') {
        let after = &rest[open + 1..];
        let digits = after.iter().take_while(|b| b.is_ascii_digit()).count();
        let number = after[..digits]
            .iter()
            .fold(0, |n, b| n * 10 + usize::from(b - b'0'));
        match args.get(number) {
            Some(arg) if digits > 0 && after.get(digits) == Some(&b'}') => {
                out.extend_from_slice(&rest[..open]);
                out.extend_from_slice(arg.as_ref());
                rest = &after[digits + 1..];
            }
            _ => {
                out.extend_from_slice(&rest[..=open]);
                rest = after;
            }
        }
    }
    out.extend_from_slice(rest);
}
