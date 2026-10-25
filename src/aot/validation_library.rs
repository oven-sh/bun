//! `prelude/validation.ts` for a program that is not compiled ahead of time: the same text, as JavaScript that the engine's other
//! tiers run. A file that Bun transpiles holds the plan of each `JSON.parse<T>()` and `validate<T>()`, and hands it to the function
//! that this text makes.

use std::borrow::Cow;

use bun_core::strings;
use bun_sema::atom::Interner;
use bun_sema::erasure::find_type_ranges;
use bun_sema::session::Session;
use bun_sema_parser::{CompileParseOptions, parse_for_compile};

use crate::prelude;

// What the library names with `$` is a built-in that a compiled program calls directly.
const BEFORE_LIBRARY: &str = r#"(function (prepared) {
  "use strict";
  const { apply, defineProperty, setPrototypeOf } = Reflect;
  const { isArray } = Array;
  const parseText = JSON.parse;
  // What the text of a plan leaves out is absent, whatever the program has put on Object.prototype.
  const withoutPrototype = (key, value) => {
    if (typeof value === "object" && value !== null && !isArray(value)) setPrototypeOf(value, null);
    return value;
  };
  const { validateByPlan } = (function ({ "#;

const BETWEEN_NAMES_AND_LIBRARY: &str = r#" }) {
"#;

const AFTER_LIBRARY: &str = r#"
    return { validateByPlan };
  })({
    __proto__: null,
    $arrayFrom: Array.from,
    $call: (f, thisArg, ...args) => apply(f, thisArg, args),
    $getOwnPropertySymbols: Object.getOwnPropertySymbols,
    $hasOwn: Object.hasOwn,
    $isArray: isArray,
    $jsonParse: text => parseText(text, withoutPrototype),
    $jsonStringify: JSON.stringify,
    $min: Math.min,
    $numberIsFinite: Number.isFinite,
    $numberIsInteger: Number.isInteger,
    $objectKeys: Object.keys,
    $putByValDirect: (object, key, value) => {
      defineProperty(object, key, { __proto__: null, value, writable: true, enumerable: true, configurable: true });
    },
    $urlCanParse: URL.canParse,
    $Map: Map,
    $Object: Object,
    $Set: Set,
  });
  return function (kind, plan) {
    if (typeof plan !== "string") throw new TypeError("The plan of a validator is a string");
    switch (kind) {
      case 0:
        // What a reviver returned is an object that the program has, so the answer is validated and handed on as it is.
        return function parse(text, reviver) {
          if (arguments.length < 2) return validateByPlan(parseText(text), plan, false, prepared);
          const answer = parseText(text, reviver);
          validateByPlan(answer, plan, false, prepared);
          return answer;
        };
      case 1:
        return function validate(value) {
          return validateByPlan(value, plan, false, prepared);
        };
      default:
        throw new TypeError("No such kind of validator");
    }
  };
})
"#;

fn find_library() -> &'static [u8] {
    let mut files = prelude::FILES.iter();
    let file = files.find(|(name, _)| *name == "validation.ts");
    file.expect("the prelude holds the library").1.as_bytes()
}

/// The name that the line declares and does not define.
fn find_declared_name(line: &[u8]) -> Option<&[u8]> {
    let declared = (line.strip_prefix(b"declare function "))
        .or_else(|| line.strip_prefix(b"declare const "))?;
    let is_of_name = |byte: &&u8| byte.is_ascii_alphanumeric() || **byte == b'$';
    Some(&declared[..declared.iter().take_while(is_of_name).count()])
}

/// An expression for a function that takes the engine's Map of prepared plans and returns `(kind, plan) => validator`.
pub fn write_validation_library() -> Vec<u8> {
    // The parameters of the function around the text stand for the declarations.
    let mut names: Vec<&[u8]> = Vec::new();
    let mut text = Vec::new();
    for line in strings::split(find_library(), b"\n") {
        match find_declared_name(line) {
            Some(name) => names.push(name),
            None => text.extend_from_slice(line),
        }
        text.push(b'\n');
    }
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let arena = session.arena();
    let options = CompileParseOptions {
        path: b"validation.ts",
        script_kind: None,
        experimental_decorators: false,
        every_file_is_a_module: false,
        reads_jsdoc: false,
        keeps_function_directives: false,
    };
    let mut file = parse_for_compile(arena, &options, &text, &atoms);
    file.text = Cow::Borrowed(arena.alloc_slice_copy(&text));
    let code = find_type_ranges(&file).remove_from(&text);

    let mut library = Vec::with_capacity(code.len() + 4096);
    library.extend_from_slice(BEFORE_LIBRARY.as_bytes());
    library.extend_from_slice(&names.join(&b", "[..]));
    library.extend_from_slice(BETWEEN_NAMES_AND_LIBRARY.as_bytes());
    // Nothing imports the text.
    for line in strings::split(&code, b"\n") {
        library.extend_from_slice(line.strip_prefix(b"export ").unwrap_or(line));
        library.push(b'\n');
    }
    library.extend_from_slice(AFTER_LIBRARY.as_bytes());
    library
}

#[repr(C)]
pub struct LibraryText {
    pointer: *const u8,
    length: usize,
}

/// UTF-8 that is never freed.
#[cfg(not(test))]
#[unsafe(no_mangle)]
pub extern "C" fn Bun__AOT__validationLibrary() -> LibraryText {
    static LIBRARY: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
    let library = LIBRARY.get_or_init(write_validation_library);
    LibraryText {
        pointer: library.as_ptr(),
        length: library.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bstr::{BStr, ByteSlice};

    #[test]
    fn every_declared_name_is_handed_to_the_library() {
        let lines = strings::split(find_library(), b"\n");
        let names: Vec<&[u8]> = lines.filter_map(find_declared_name).collect();
        assert!(names.contains(&&b"$isArray"[..]) && names.contains(&&b"$Map"[..]));
        for name in names {
            let handed = [b"\n    ", name, b": "].concat();
            assert!(
                AFTER_LIBRARY.as_bytes().contains_str(handed),
                "{} is declared by prelude/validation.ts, and a program that is not compiled gets nothing under that name",
                BStr::new(name)
            );
        }
    }

    #[test]
    fn library_has_no_types_and_no_exports() {
        let library = write_validation_library();
        assert!(library.contains_str("\nfunction validateByPlan("));
        for word in [
            "\nexport ",
            "\ndeclare ",
            "\ntype ",
            "\ninterface ",
            ": unknown",
            "<any>",
        ] {
            assert!(!library.contains_str(word), "{word:?} is left");
        }
    }
}
