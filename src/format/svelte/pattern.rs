//! The plugin's `_expandNode`: how it prints the patterns of `{#each}`, `{:then}` and `{:catch}`.

use crate::html::js::Parse;
use bun_lint::ast::{Expr, ExprKind, File, Key, KeyKind, Pat, PatKind, PropKind, StmtKind};

/// What it throws for: `unknown node type`.
struct Unknown;

/// `key.name`
fn name_of_key<'f>(key: Key<'f>) -> Option<&'f [u8]> {
    match key.kind() {
        KeyKind::Ident(name) => Some(name.bytes()),
        KeyKind::Computed(e) => match e.kind() {
            ExprKind::Ident(name) => Some(name.bytes()),
            _ => None,
        },
        _ => None,
    }
}

struct Expander<'f> {
    file: &'f File<'f>,
    out: Vec<u8>,
}

impl<'f> Expander<'f> {
    fn push(&mut self, text: &[u8]) {
        self.out.extend_from_slice(text);
    }

    /// Calls `write` for each of `items`, with commas in between.
    fn join<T>(
        &mut self,
        items: impl Iterator<Item = T>,
        mut write: impl FnMut(&mut Self, T) -> Result<(), Unknown>,
    ) -> Result<(), Unknown> {
        for (index, item) in items.enumerate() {
            if index > 0 {
                self.push(b",");
            }
            write(self, item)?;
        }
        Ok(())
    }

    /// Takes out the blank that what has been written from `start` on begins with: `.slice(1)`.
    fn remove_first_from(&mut self, start: usize) {
        if start < self.out.len() {
            self.out.remove(start);
        }
    }

    /// The key of a property: ` [key]`, or the name.
    fn key(&mut self, key: Key<'f>, is_only_name: bool) -> Result<(), Unknown> {
        let written = self.file.slice(key.inner_span(self.file));
        if key.is_computed() {
            self.push(b" [");
            self.push(written);
            self.push(b"]");
            return Ok(());
        }
        self.push(b" ");
        match (is_only_name, written.first()) {
            // `node.key.name` of a literal
            (true, Some(b'"' | b'\'' | b'0'..=b'9' | b'.')) => self.push(b"undefined"),
            _ => self.push(written),
        }
        Ok(())
    }

    /// `left = right`
    fn with_default(&mut self, pattern: Pat<'f>, default: Option<Expr<'f>>) -> Result<(), Unknown> {
        self.pattern(pattern)?;
        if let Some(default) = default {
            self.push(b" =");
            self.expression(default)?;
        }
        Ok(())
    }

    fn pattern(&mut self, pattern: Pat<'f>) -> Result<(), Unknown> {
        match pattern.kind() {
            PatKind::Missing => Err(Unknown),
            PatKind::Ident(name) => {
                self.push(b" ");
                self.push(name.bytes());
                Ok(())
            }
            PatKind::Array(elements) => {
                self.push(b" [");
                let start = self.out.len();
                self.join(elements.iter(), |it, element| {
                    let Some(pattern) = element.pat() else {
                        it.push(b" ");
                        return Ok(());
                    };
                    if !element.is_rest() {
                        return it.with_default(pattern, element.default());
                    }
                    it.push(b" ...");
                    let start = it.out.len();
                    it.pattern(pattern)?;
                    it.remove_first_from(start);
                    Ok(())
                })?;
                self.remove_first_from(start);
                self.push(b"]");
                Ok(())
            }
            PatKind::Object(properties) => {
                self.push(b" {");
                self.join(properties.iter(), |it, property| {
                    let value = property.value();
                    let Some(key) = property.key().filter(|_| !property.is_rest()) else {
                        it.push(b" ...");
                        let start = it.out.len();
                        it.pattern(value)?;
                        it.remove_first_from(start);
                        return Ok(());
                    };
                    let has_default = property.default().is_some();
                    match value.kind() {
                        PatKind::Object(_) | PatKind::Array(_) if !has_default => {
                            it.key(key, true)?;
                            it.push(b":");
                            it.pattern(value)
                        }
                        PatKind::Ident(name)
                            if !has_default && name_of_key(key) != Some(name.bytes()) =>
                        {
                            it.key(key, false)?;
                            it.push(b":");
                            it.pattern(value)
                        }
                        // The key of `a: b = 1` is lost.
                        _ => it.with_default(value, property.default()),
                    }
                })?;
                self.push(b" }");
                Ok(())
            }
        }
    }

    /// A default value. Only names, literals, arrays and objects are known.
    fn expression(&mut self, e: Expr<'f>) -> Result<(), Unknown> {
        match e.kind() {
            ExprKind::Ident(_)
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex(_) => {
                self.push(b" ");
                self.push(e.text());
                Ok(())
            }
            ExprKind::Array(elements) => {
                self.push(b" [");
                let start = self.out.len();
                self.join(elements.iter(), |it, element| match element.kind() {
                    ExprKind::Missing => {
                        it.push(b" ");
                        Ok(())
                    }
                    _ => it.expression(element),
                })?;
                self.remove_first_from(start);
                self.push(b"]");
                Ok(())
            }
            ExprKind::Object(properties) => {
                self.push(b" {");
                self.join(properties.iter(), |it, property| {
                    let (Some(key), Some(value)) = (property.key(), property.value()) else {
                        return Err(Unknown);
                    };
                    if !matches!(property.kind(), PropKind::Init | PropKind::Shorthand) {
                        return Err(Unknown);
                    }
                    it.key(key, false)?;
                    it.push(b":");
                    it.expression(value)
                })?;
                self.push(b" }");
                Ok(())
            }
            _ => Err(Unknown),
        }
    }
}

/// `_expandNode(pattern)`. `None`: it throws.
pub(crate) fn expand(parse: Parse<'_>, pattern: &[u8], is_typescript: bool) -> Option<Vec<u8>> {
    // Most are a name.
    if bun_lint::utils::text::is_identifier_name(pattern) {
        return Some([b" ", pattern].concat());
    }
    let program = [b"function _(", pattern, b"\n) {}"].concat();
    let path: &[u8] = if is_typescript {
        b"dummy.ts"
    } else {
        b"dummy.js"
    };
    let mut expanded = None;
    parse.call(path, &program, false, &mut |file| {
        if file.has_parse_errors() {
            return;
        }
        let Some(StmtKind::Fn(function)) = file.body().iter().next().map(|it| it.kind()) else {
            return;
        };
        let Some(parameter) = function.params().iter().next() else {
            return;
        };
        let mut expander = Expander {
            file,
            out: Vec::new(),
        };
        if expander.pattern(parameter.pat()).is_ok() {
            expanded = Some(expander.out);
        }
    });
    expanded
}
