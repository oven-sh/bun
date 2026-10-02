//! A description of a type that does not depend on who computed it, for comparing this resolver with another one.
//! The other side is a script over the TypeScript compiler that prints the same thing.
//!
//! Literals are widened, except single ones in the property lists of anonymous object types. Classes and interfaces go by name
//! and number of properties, anonymous object types by their properties. `?` is "not resolved".

use crate::atom::Atom;
use crate::bind::{Decl, SymFlags};
use crate::check::Checker;
use crate::program::Sym;
use crate::types::*;

const MAX_PROPS: usize = 48;
pub const DEPTH: u32 = 2;

pub struct Describer<'c, 'p> {
    pub c: &'c mut Checker<'p>,
}

fn json_string(text: &str, out: &mut String) {
    out.push('"');
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// `RemoveFileExtension`
fn without_extension(path: &str) -> &str {
    const EXTENSIONS: [&str; 12] = [
        ".d.ts", ".d.mts", ".d.cts", ".mjs", ".mts", ".cjs", ".cts", ".ts", ".js", ".tsx", ".jsx",
        ".json",
    ];
    EXTENSIONS
        .iter()
        .find_map(|ext| path.strip_suffix(*ext))
        .unwrap_or(path)
}

/// The order of JavaScript's `<` and default `sort` on strings: by UTF-16 code unit.
fn compare_utf16(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

impl<'c, 'p> Describer<'c, 'p> {
    pub fn new(c: &'c mut Checker<'p>) -> Self {
        Describer { c }
    }

    pub fn describe(&mut self, ty: TypeId) -> String {
        self.desc(ty, DEPTH)
    }

    fn name(&self, atom: Atom) -> String {
        self.c.p.files.atoms.text(atom).into_owned()
    }

    /// `symbol.Name` in tsgo, with `__` for the prefix of an internal name.
    fn sym_name(&self, sym: Sym) -> String {
        let symbol = self.c.p.files.symbol(sym);
        let hir = self.c.hir(sym.file);
        // `mergeSymbol`, `cloneSymbol`: a merged symbol keeps the name of the merge target, so only the declarations bound to `sym`
        // itself count. Our binder keeps a default export and a local declaration of the same name in one symbol, so the first class
        // or interface declaration decides. Without one (an interface merged into a function), the first function declaration decides.
        let modifiers = symbol
            .decls
            .iter()
            .find_map(|&decl| match decl {
                Decl::Class(class) => Some(hir[class].flags),
                Decl::Interface(interface) => Some(hir[interface].flags),
                _ => None,
            })
            .or_else(|| {
                symbol.decls.iter().find_map(|&decl| match decl {
                    Decl::Fn(function) => Some(hir[function].flags),
                    _ => None,
                })
            });
        // `declareSymbolEx`: a default export that has a parent is named `default`.
        if symbol.parent.is_some()
            && modifiers.is_some_and(|flags| flags.contains(crate::hir::Flags::DEFAULT))
        {
            return "default".to_owned();
        }
        if symbol.name.is_some() {
            // `getDeclarationName`: a class declaration without a name is named `InternalSymbolNameMissing`.
            if let Some(&Decl::Class(class)) = symbol.decls.first()
                && hir[class].name.is_none()
            {
                return "__missing".to_owned();
            }
            return self.name(symbol.name);
        }
        // `bindSourceFileAsExternalModule`: a file goes by its path without the extension, in quotes.
        if symbol.decls.contains(&Decl::File) {
            return format!(
                "\"{}\"",
                without_extension(&self.c.p.files.module(sym.file).path)
            );
        }
        "__class".to_owned()
    }

    fn is_lib(&self, sym: Sym) -> bool {
        self.c
            .p
            .files
            .decls(sym)
            .iter()
            .any(|d| self.c.p.files.module(d.0).is_lib)
    }

    fn primitive(&self, ty: TypeId) -> Option<&'static str> {
        let c = &*self.c;
        Some(match c.data(ty) {
            TypeData::UnresolvedName { .. } => "any",
            TypeData::Intrinsic(i) => match i {
                Intrinsic::Unresolved => "?",
                Intrinsic::Any => "any",
                Intrinsic::Error | Intrinsic::Auto => "any",
                Intrinsic::Unknown => "unknown",
                Intrinsic::Never | Intrinsic::SilentNever | Intrinsic::UnreachableNever => "never",
                Intrinsic::Void => "void",
                Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedDeclared => {
                    "undefined"
                }
                Intrinsic::Null | Intrinsic::NullDeclared => "null",
                Intrinsic::String => "string",
                Intrinsic::Number => "number",
                Intrinsic::BigInt => "bigint",
                Intrinsic::Symbol => "symbol",
                Intrinsic::Object => "object",
            },
            _ if c.is_boolean(ty) || c.is_boolean_like(ty) => "boolean",
            _ if c.is_string_like(ty) => "string",
            _ if c.is_number_like(ty) => "number",
            _ if c.is_bigint_like(ty) => "bigint",
            _ if c.is_symbol_like(ty) => "symbol",
            _ => return None,
        })
    }

    fn unit_literal(&self, ty: TypeId) -> Option<String> {
        match *self.c.data(ty) {
            TypeData::StringLit { value, .. }
            | TypeData::EnumLit {
                value: EnumValue::String(value),
                ..
            } => {
                let mut out = String::new();
                json_string(&self.name(value), &mut out);
                Some(out)
            }
            TypeData::NumberLit { bits, .. }
            | TypeData::EnumLit {
                value: EnumValue::Number(bits),
                ..
            } => Some(crate::atom::number_to_string(f64::from_bits(bits))),
            TypeData::BoolLit { value, .. } => {
                Some(if value { "true" } else { "false" }.to_owned())
            }
            _ => None,
        }
    }

    fn collect(&mut self, ty: TypeId, d: u32, out: &mut Vec<String>) {
        let ty = self.c.force(ty);
        if !self.c.is_boolean(ty)
            && let TypeData::Union(parts) = self.c.data(ty)
        {
            for &p in parts.iter() {
                self.collect(p, d, out);
            }
            return;
        }
        if let TypeData::ThisParam(sym) = *self.c.data(ty) {
            let declared = self.c.declared_type(sym);
            self.collect(declared, d, out);
            return;
        }
        // The other side collects the members of the base type of a substitution type.
        if let TypeData::Substitution { base, .. } = *self.c.data(ty) {
            self.collect(base, d, out);
            return;
        }
        let s = self.desc(ty, d);
        if !out.contains(&s) {
            out.push(s);
        }
    }

    fn join_union(&mut self, ty: TypeId, d: u32) -> String {
        let mut parts = Vec::new();
        self.collect(ty, d, &mut parts);
        for top in ["?", "any", "unknown"] {
            if parts.iter().any(|p| p == top) {
                return top.to_owned();
            }
        }
        if parts.len() > 1 {
            parts.retain(|p| p != "never");
        }
        parts.sort_by(|a, b| compare_utf16(a, b));
        parts.join("|")
    }

    fn desc(&mut self, ty: TypeId, d: u32) -> String {
        let ty = self.c.force(ty);
        if let Some(p) = self.primitive(ty) {
            return p.to_owned();
        }
        self.desc_inner(ty, d)
    }

    fn type_args(&mut self, args: &[TypeId], d: u32) -> String {
        if args.is_empty() || d == 0 {
            return String::new();
        }
        let list: Vec<String> = args.iter().map(|&a| self.desc(a, d - 1)).collect();
        format!("<{}>", list.join(","))
    }

    fn prop_count(&mut self, ty: TypeId) -> usize {
        self.c.members(ty).map_or(0, |m| m.shape().props.len())
    }

    fn desc_inner(&mut self, ty: TypeId, d: u32) -> String {
        match self.c.data(ty).clone() {
            TypeData::Union(_) | TypeData::ThisParam(_) => self.join_union(ty, d),
            // `getUniqueTypeParameters` renames a type parameter whose name is taken.
            TypeData::TypeParam(file, tp, _) => {
                let name = self
                    .c
                    .type_param_name(ty)
                    .unwrap_or(self.c.hir(file)[tp].name);
                format!("tp:{}", self.name(name))
            }
            TypeData::Keyof(_) => "keyof".to_owned(),
            TypeData::Substitution { base: t, .. } => self.desc(t, d),
            TypeData::IndexedAccess { .. } => "tpx".to_owned(),
            TypeData::Cond { .. } => "cond".to_owned(),
            TypeData::LazyAlias { .. } => "?".to_owned(),
            TypeData::Intersection(parts) => {
                for &p in parts.iter() {
                    if let Some(s) = self.primitive(p)
                        && !matches!(s, "object" | "any" | "unknown")
                    {
                        return s.to_owned();
                    }
                }
                if parts.iter().any(|&p| self.c.is_deferred(p)) {
                    return "tpx".to_owned();
                }
                // The compiler keeps it in unions and reports no properties for it.
                if self.c.is_never_intersection(ty) {
                    return "{}".to_owned();
                }
                self.structural(ty, d)
            }
            TypeData::Tuple { elems, flags, .. } => {
                if d == 0 {
                    return "tuple".to_owned();
                }
                let list: Vec<String> = elems
                    .iter()
                    .zip(flags.iter())
                    .map(|(&e, f)| {
                        format!(
                            "{}{}{}",
                            if f.intersects(ElemFlags::REST | ElemFlags::VARIADIC) {
                                "..."
                            } else {
                                ""
                            },
                            self.desc(e, d - 1),
                            if f.contains(ElemFlags::OPTIONAL) {
                                "?"
                            } else {
                                ""
                            }
                        )
                    })
                    .collect();
                format!("[{}]", list.join(","))
            }
            TypeData::Ref { target, args } => {
                if let Some(element) = self.c.array_element(ty) {
                    return if d == 0 {
                        "Array".to_owned()
                    } else {
                        format!("Array<{}>", self.desc(element, d - 1))
                    };
                }
                let name = self.sym_name(target);
                if d == 0 {
                    return name;
                }
                let count = if self.is_lib(target) {
                    String::new()
                } else {
                    format!("#{}", self.prop_count(ty))
                };
                // `getTypeWithThisArgument` appends the `this` argument to the type arguments. The other side prints one argument per
                // type parameter.
                let declared = self.c.declared_type(target);
                let type_param_count = match self.c.data(declared) {
                    TypeData::Ref { args: params, .. } => params.len().min(args.len()),
                    _ => args.len(),
                };
                format!(
                    "{name}{count}{}",
                    self.type_args(&args[..type_param_count], d)
                )
            }
            TypeData::Anon { origin, .. } => match origin {
                Origin::ClassStatic(sym) => format!("typeof {}", self.sym_name(sym)),
                Origin::EnumObject(sym) => format!("enumobj {}", self.sym_name(sym)),
                Origin::Module(_) | Origin::GlobalThis => self.module(ty, d),
                Origin::Function(sym) if self.c.p.files.flags(sym).intersects(SymFlags::MODULE) => {
                    self.module(ty, d)
                }
                // `cloneTypeAsModuleType`: the clone has the flags and the name of what it is a clone of.
                Origin::Namespace { module, .. } => {
                    let flags = self.c.p.files.flags(module);
                    if flags.contains(SymFlags::CLASS) {
                        format!("typeof {}", self.sym_name(module))
                    } else if flags.contains(SymFlags::ENUM) {
                        format!("enumobj {}", self.sym_name(module))
                    } else if flags.intersects(SymFlags::MODULE) {
                        self.module(ty, d)
                    } else {
                        self.structural(ty, d)
                    }
                }
                _ => self.structural(ty, d),
            },
            _ => self.structural(ty, d),
        }
    }

    fn module(&mut self, ty: TypeId, d: u32) -> String {
        if d == 0 {
            "module".to_owned()
        } else {
            format!("module#{}", self.prop_count(ty))
        }
    }

    fn structural(&mut self, ty: TypeId, d: u32) -> String {
        // The properties of `{ [K in keyof T]: X }` with a `T` that is some array are those of the array it comes to.
        let ty = if matches!(
            self.c.data(ty),
            TypeData::Anon {
                origin: Origin::Mapped(..),
                ..
            }
        ) {
            self.c.apparent_type(ty)
        } else {
            ty
        };
        // Which may be one of several arrays: what all of them have (`getPropertiesOfUnionOrIntersectionType`).
        let ty = if self.c.is_union(ty) {
            self.c.union_as_object(ty)
        } else {
            ty
        };
        let Some(members) = self.c.members(ty) else {
            return "?".to_owned();
        };
        let shape = members.shape();
        let func = if shape.call.len() == 1 {
            if d == 0 {
                "fn".to_owned()
            } else {
                let sig = self.c.instantiate_sig(shape.call[0], members.mapper);
                let count = self.c.sig_params(sig).len();
                let ret = self.c.sig_return(sig);
                format!("fn({count})=>{}", self.desc(ret, d - 1))
            }
        } else if shape.call.len() > 1 {
            format!("fn*{}", shape.call.len())
        } else if !shape.construct.is_empty() {
            format!("new*{}", shape.construct.len())
        } else {
            String::new()
        };
        if shape.props.is_empty() && shape.index.is_empty() {
            return if func.is_empty() {
                "{}".to_owned()
            } else {
                func
            };
        }
        if d == 0 {
            return if func.is_empty() { "obj" } else { "fn&obj" }.to_owned();
        }
        // Which symbol the key of a symbol (`\xFE@name@…`, `__@name@…`) is, and which class's a `#x@…`, does not compare across
        // tools; the name does. The other side prints `__@name` and `#x`.
        let atoms = &self.c.p.files.atoms;
        let key_name = |name: Atom| -> String {
            let bytes: &[u8] = if name.is_some() {
                atoms.bytes(name)
            } else {
                &[]
            };
            let cut = |text: &[u8]| {
                let end = bun_core::strings::index_of_char_usize(text, b'@').unwrap_or(text.len());
                String::from_utf8_lossy(&text[..end]).into_owned()
            };
            if let Some(rest) = bytes
                .strip_prefix(b"\xFE@")
                .or_else(|| bytes.strip_prefix(b"__@"))
            {
                format!("__@{}", cut(rest))
            } else if bytes.first() == Some(&b'#') {
                cut(bytes)
            } else {
                atoms.text(name).into_owned()
            }
        };
        let mut sorted: Vec<(String, &Prop)> =
            shape.props.iter().map(|p| (key_name(p.name), p)).collect();
        sorted.sort_by(|a, b| compare_utf16(&a.0, &b.0));
        let mut parts = Vec::new();
        for (name, prop) in sorted.iter().take(MAX_PROPS) {
            let ty = self.c.type_of_prop(prop, members.mapper);
            let text = match self.unit_literal(ty) {
                Some(literal) => literal,
                None => self.desc(ty, d - 1),
            };
            parts.push(format!(
                "{name}{}:{text}",
                if prop.flags.contains(PropFlags::OPTIONAL) {
                    "?"
                } else {
                    ""
                }
            ));
        }
        if sorted.len() > MAX_PROPS {
            parts.push(format!("+{}", sorted.len() - MAX_PROPS));
        }
        let mut infos: Vec<String> = shape
            .index
            .iter()
            .map(|i| {
                let value = self.c.instantiate(i.value, members.mapper);
                format!("[{}]:{}", self.desc(i.key, 0), self.desc(value, d - 1))
            })
            .collect();
        infos.sort_by(|a, b| compare_utf16(a, b));
        parts.extend(infos);
        format!(
            "{}{{{}}}",
            if func.is_empty() {
                String::new()
            } else {
                format!("{func}&")
            },
            parts.join(",")
        )
    }
}
