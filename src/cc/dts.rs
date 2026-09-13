//! TypeScript declarations for what a translation unit exports to JavaScript: one
//! `export function` per C function that `bun:ffi` can call, typed the way values cross
//! that boundary, with the C prototype as its documentation.

use std::fmt::Write as _;

use crate::ast::{Function, Program};
use crate::types::{Type, TypeCtx};

/// How a C type looks from JavaScript, as a parameter or as a result. `None`: values of
/// that type cannot be passed (structures, vectors, `__int128`, complex numbers).
fn typescript_type(ty: &Type, tcx: &TypeCtx, is_result: bool) -> Option<&'static str> {
    let ty = ty.unatomic();
    Some(match ty {
        Type::Void => "void",
        Type::Bool => "boolean",
        Type::Float | Type::Double => "number",
        _ if ty.is_ptr() && is_result => "Pointer | null",
        _ if ty.is_ptr() => "Pointer | NodeJS.TypedArray | null",
        _ if ty.is_pair() || ty.is_struct() || ty.is_vector() || matches!(ty, Type::Wide(_)) => {
            return None;
        }
        _ if ty.is_integer() => {
            if tcx.size_of(ty)? > 4 {
                "bigint"
            } else {
                "number"
            }
        }
        _ => return None,
    })
}

/// Words that cannot name a function or a parameter in TypeScript.
const RESERVED: &[&str] = &[
    "arguments",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "eval",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "function",
    "if",
    "implements",
    "import",
    "in",
    "instanceof",
    "interface",
    "let",
    "new",
    "null",
    "package",
    "private",
    "protected",
    "public",
    "return",
    "static",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
];

/// A JavaScript identifier for parameter `index`: its C name, unless that is a reserved
/// word or another parameter already has it.
fn parameter_name(name: Option<&str>, index: usize, taken: &[String]) -> String {
    let mut candidate = match name {
        Some(name) if !RESERVED.contains(&name) => name.to_string(),
        Some(name) => format!("{name}_"),
        None => format!("arg{index}"),
    };
    while taken.contains(&candidate) {
        candidate.push('_');
    }
    candidate
}

fn c_prototype(f: &Function, tcx: &TypeCtx) -> String {
    let mut text = format!("{} {}(", tcx.display(&f.ty.ret), f.name);
    for (i, param) in f.ty.params.iter().enumerate() {
        if i > 0 {
            text.push_str(", ");
        }
        text.push_str(&tcx.display(param));
        if let Some(Some(name)) = f.param_names.get(i) {
            let _ = write!(text, " {name}");
        }
    }
    if f.ty.params.is_empty() && !f.ty.unprototyped {
        text.push_str("void");
    }
    if f.ty.variadic {
        text.push_str(", ...");
    }
    text.push(')');
    // The text goes inside a `/** */` comment, which `*/` would end.
    let mut safe = String::with_capacity(text.len());
    for c in text.chars() {
        if c == '/' && safe.ends_with('*') {
            safe.push(' ');
        }
        safe.push(c);
    }
    safe
}

/// The declarations for the functions `program` defines with external linkage.
pub(crate) fn typescript_declarations(program: &Program) -> String {
    let tcx = &program.tcx;
    let mut out = String::from("import type { Pointer } from \"bun:ffi\";\n");
    let mut exported: Vec<&str> = Vec::new();
    let declare = |out: &mut String, name: &str, f: &Function| {
        let prototype = c_prototype(f, tcx);
        if f.ty.variadic {
            let _ = writeln!(
                out,
                "\n// {name}: `{prototype}` takes a variable number of arguments, which JavaScript cannot pass."
            );
            return false;
        }
        let ret = typescript_type(&f.ty.ret, tcx, true);
        let mut params: Vec<(String, &'static str)> = Vec::new();
        let mut names: Vec<String> = Vec::new();
        for (i, ty) in f.ty.params.iter().enumerate() {
            let Some(ts) = typescript_type(ty, tcx, false) else {
                break;
            };
            let c_name = f.param_names.get(i).and_then(|n| n.as_deref());
            let name = parameter_name(c_name, i, &names);
            names.push(name.clone());
            params.push((name, ts));
        }
        let (Some(ret), true) = (ret, params.len() == f.ty.params.len()) else {
            let _ = writeln!(
                out,
                "\n// {name}: `{prototype}` takes or returns a value that cannot cross into JavaScript."
            );
            return false;
        };
        let _ = writeln!(out, "\n/** `{prototype}` */");
        let list: Vec<String> = params.iter().map(|(n, t)| format!("{n}: {t}")).collect();
        let _ = writeln!(out, "export function {name}({}): {ret};", list.join(", "));
        true
    };
    for f in &program.funcs {
        let defined = f.body.is_some() && !f.is_static && f.external;
        if !defined {
            continue;
        }
        // The name JavaScript sees is the linker's.
        let name: &str = f.link_name.as_deref().unwrap_or(&f.name);
        if is_identifier(name) && declare(&mut out, name, f) {
            exported.push(name);
        }
    }
    for (alias, id) in &program.function_aliases {
        let Some(f) = program.funcs.get(*id as usize) else {
            continue;
        };
        if f.body.is_some()
            && is_identifier(alias)
            && !exported.contains(&&**alias)
            && declare(&mut out, alias, f)
        {
            exported.push(alias);
        }
    }
    out.push_str("\ndeclare const _default: {\n");
    for name in &exported {
        let _ = writeln!(out, "  {name}: typeof {name};");
    }
    out.push_str("};\nexport default _default;\n");
    out
}

fn is_identifier(name: &str) -> bool {
    let mut bytes = name.bytes();
    !RESERVED.contains(&name)
        && bytes
            .next()
            .is_some_and(|b| b.is_ascii_alphabetic() || b == b'_' || b == b'$')
        && bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'$')
}
