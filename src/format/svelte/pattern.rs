//! The plugin's `_expandNode`: how it prints the patterns of `{#each}`, `{:then}` and `{:catch}`.

use crate::html::js::Parse;
use crate::stack::Stack;
use bun_lint::ast::{Expr, ExprKind, File, Key, KeyKind, Pat, PatKind, PropKind, StmtKind};

/// What it throws for: `unknown node type`.
struct Unknown;

struct Expander<'f, 's> {
    file: &'f File<'f>,
    out: Vec<u8>,
    stack: &'s Stack,
}

impl<'f> Expander<'f, '_> {
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

    /// The key of a property, and the `:`. Before a pattern the plugin prints `key.name`, which a literal does not have:
    /// `undefined:`.
    fn key(&mut self, key: Key<'f>) {
        let written = self.file.slice(key.inner_span(self.file));
        match key.is_computed() {
            true => [&b" ["[..], written, b"]:"]
                .iter()
                .for_each(|it| self.push(it)),
            false => [&b" "[..], written, b":"]
                .iter()
                .for_each(|it| self.push(it)),
        }
    }

    /// `left = right`
    fn with_default(&mut self, pattern: Pat<'f>, default: Option<Expr<'f>>) -> Result<(), Unknown> {
        self.pattern(pattern)?;
        if let Some(default) = default {
            self.push(b" =");
            self.expression(default);
        }
        Ok(())
    }

    fn pattern(&mut self, pattern: Pat<'f>) -> Result<(), Unknown> {
        if !self.stack.has_room() {
            return Ok(());
        }
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
                    // The plugin leaves the key out wherever there is a default, and where a computed key is the name:
                    // `b: c = 1` is `c = 1`, `[a]: a` is `a`.
                    let is_shorthand = matches!(
                        (key.kind(), value.kind()),
                        (KeyKind::Ident(key), PatKind::Ident(name)) if key.bytes() == name.bytes()
                    );
                    if !is_shorthand {
                        it.key(key);
                    }
                    it.with_default(value, property.default())
                })?;
                self.push(b" }");
                Ok(())
            }
        }
    }

    /// A default value. The plugin knows names, literals, arrays and objects, and throws for `a = -1`. Here that is as it is
    /// written.
    fn expression(&mut self, e: Expr<'f>) {
        let start = self.out.len();
        if self.known_expression(e).is_err() {
            self.out.truncate(start);
            self.push(b" ");
            self.push(self.file.slice(e.outer_span()));
        }
    }

    fn known_expression(&mut self, e: Expr<'f>) -> Result<(), Unknown> {
        if !self.stack.has_room() {
            return Ok(());
        }
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
                    _ => {
                        it.expression(element);
                        Ok(())
                    }
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
                    it.key(key);
                    it.expression(value);
                    Ok(())
                })?;
                self.push(b" }");
                Ok(())
            }
            _ => Err(Unknown),
        }
    }
}

pub(crate) const BEFORE_PATTERN: &[u8] = b"function _(";

pub(crate) fn path_of(is_typescript: bool) -> &'static [u8] {
    match is_typescript {
        true => b"dummy.ts",
        false => b"dummy.js",
    }
}

/// Where `key` is behind [`BEFORE_PATTERN`], if it is `name` and before `value_start`.
#[optimize(size)]
fn repeated_key<'f>(
    file: &'f File<'f>,
    key: Key<'f>,
    name: &[u8],
    value_start: u32,
) -> Option<(usize, usize)> {
    let (span, before) = (key.inner_span(file), BEFORE_PATTERN.len());
    (matches!(key.kind(), KeyKind::Ident(it) if it.bytes() == name)
        && !key.is_computed()
        && span.end <= value_start)
        .then(|| (span.start as usize - before, span.end as usize - before))
}

/// Where the keys are in `pattern` that are the names behind them: the first `a` of `{ a: a }`. `expand` leaves it out of a
/// pattern, and writes it in an object that is a default: `{ b = { a } }` is `{ b = { a: a } }`.
#[optimize(size)]
pub(crate) fn repeated_keys(
    parse: Parse<'_>,
    pattern: &[u8],
    is_typescript: bool,
) -> Vec<(usize, usize)> {
    let mut keys = Vec::new();
    let program = [BEFORE_PATTERN, pattern, b"\n) {}"].concat();
    parse.call(path_of(is_typescript), &program, false, &mut |file| {
        let Some(StmtKind::Fn(function)) = file.body().iter().next().map(|it| it.kind()) else {
            return;
        };
        let mut patterns: Vec<Pat<'_>> = function.params().iter().map(|it| it.pat()).collect();
        let mut defaults: Vec<Expr<'_>> = Vec::new();
        while let Some(pattern) = patterns.pop() {
            match pattern.kind() {
                PatKind::Array(elements) => {
                    patterns.extend(elements.iter().filter_map(|it| it.pat()));
                    defaults.extend(elements.iter().filter_map(|it| it.default()));
                }
                PatKind::Object(properties) => {
                    for property in properties.iter() {
                        let value = property.value();
                        patterns.push(value);
                        defaults.extend(property.default());
                        if let (Some(key), PatKind::Ident(name)) = (property.key(), value.kind()) {
                            keys.extend(repeated_key(file, key, name.bytes(), value.span().start));
                        }
                    }
                }
                PatKind::Ident(_) | PatKind::Missing => {}
            }
        }
        while let Some(default) = defaults.pop() {
            match default.kind() {
                ExprKind::Array(elements) => defaults.extend(elements.iter()),
                ExprKind::Object(properties) => {
                    for property in properties.iter() {
                        let (Some(key), Some(value)) = (property.key(), property.value()) else {
                            continue;
                        };
                        defaults.push(value);
                        if let ExprKind::Ident(name) = value.kind() {
                            keys.extend(repeated_key(file, key, name.bytes(), value.span().start));
                        }
                    }
                }
                _ => {}
            }
        }
    });
    keys
}

/// `_expandNode(pattern)`
pub(crate) fn expand(
    parse: Parse<'_>,
    pattern: &[u8],
    is_typescript: bool,
    stack: &Stack,
) -> Vec<u8> {
    let as_written = || [b" ", pattern].concat();
    // Most are a name.
    if bun_lint::utils::text::is_identifier_name(pattern) {
        return as_written();
    }
    let program = [BEFORE_PATTERN, pattern, b"\n) {}"].concat();
    let mut expanded = None;
    parse.call(path_of(is_typescript), &program, false, &mut |file| {
        if file.has_parse_errors() {
            return;
        }
        let Some(StmtKind::Fn(function)) = file.body().iter().next().map(|it| it.kind()) else {
            return;
        };
        let Some(parameter) = function.params().iter().next() else {
            return;
        };
        // The plugin loses them.
        if file.comments().into_iter().next().is_some() {
            return;
        }
        let mut expander = Expander {
            file,
            out: Vec::new(),
            stack,
        };
        if expander.pattern(parameter.pat()).is_ok() {
            expanded = Some(expander.out);
        }
    });
    expanded.unwrap_or_else(as_written)
}
