//! A `hir::File` as text, to compare what two front ends make of the same source.
//!
//! In which order the nodes were pushed into their vectors is nobody's business, so no id is ever printed: the tree is walked from
//! `File::body`, a node is one line with everything it says itself, and what it names follows, indented, after the name of the field.
//!
//! ```text
//! body[1]:
//!   Stmt If pos=0
//!     test: Expr Ident pos=4 "a"
//!     yes: Stmt Empty pos=6
//!     no: -
//! ```

use bun_sema::atom::{Atom, Interner};
use bun_sema::hir::*;
use std::fmt::Write;

/// Nothing is printed below this depth: a tree that got to hold itself would never end.
const MAX_DEPTH: usize = 2000;

/// Stands for what an id past the end of its vector names.
const NO_SUCH_NODE: &str = "<no such node>";

/// One line: `put!(self, depth, label, "format", arguments..)`.
macro_rules! put {
    ($self:ident, $depth:expr, $label:expr, $($format:tt)*) => {{
        let text = format!($($format)*);
        $self.line($depth, $label, &text);
    }};
}

/// The node `$id` names in `File::$arena`. Where there is none to print, a line says why and the function returns.
macro_rules! node {
    ($self:ident, $depth:ident, $label:ident, $arena:ident, $id:ident) => {{
        if $id.is_none() {
            return $self.line($depth, $label, "-");
        }
        if $depth > MAX_DEPTH {
            return $self.line($depth, $label, "...");
        }
        match $self.file.$arena.get($id.idx()) {
            Some(node) => {
                $self.seen.insert((stringify!($arena), $id.idx() as u32));
                *node
            }
            None => return $self.line($depth, $label, NO_SUCH_NODE),
        }
    }};
}

struct Dump<'a> {
    file: &'a File,
    atoms: &'a Interner,
    out: String,
    /// Every node that was come to: in which vector, and where in it.
    seen: std::collections::HashSet<(&'static str, u32)>,
}

/// `file`, in a form that is the same for every order its nodes can be pushed in.
/// It recurses as deep as the tree is, down to `MAX_DEPTH`: to be called where there is room for that.
pub fn dump(file: &File, atoms: &Interner) -> String {
    dump_and_orphans(file, atoms).0
}

/// With the nodes nothing leads to, which whoever goes over a whole vector comes to all the same: `vector[index] pos=..`.
pub fn dump_and_orphans(file: &File, atoms: &Interner) -> (String, Vec<String>) {
    // Every field by name, so that a new one has to be dealt with. `error_pos` only says where to point when a parser gave up.
    let File {
        kind,
        has_module_syntax,
        is_js,
        check_directive,
        is_module_by_decree,
        has_errors,
        decorators,
        legacy_decorators,
        directives: _,
        early_errors,
        error_arguments: _,
        error_ends: _,
        syntax_errors,
        error_pos: _,
        opening_brackets: _,
        source_len,
        text: _,
        unclosed_literals: _,
        expr_ends: _,
        body,
        references,
        suppressed,
        with_bodies,
        after_skipped,
        stray_decorators,
        specifier_uses,
        deferred_import_calls,
        import_attributes,
        specifier_expressions,
        has_parse_diagnostics,
        checker_errors,
        parens,
        jsx_pragmas,
        jsdoc_comments,
        jsdoc_errors,
        jsdoc_types,
        jsdoc_modifiers,
        jsdoc_param_errors,
        ids: _,
        numbers: _,
        exprs: _,
        stmts: _,
        types: _,
        pats: _,
        pat_props: _,
        pat_elems: _,
        fns: _,
        params: _,
        type_params: _,
        classes: _,
        interfaces: _,
        aliases: _,
        enums: _,
        enum_members: _,
        modules: _,
        members: _,
        props: _,
        var_decls: _,
        calls: _,
        cases: _,
        jsx: _,
        imports: _,
        import_specs: _,
        import_equals: _,
        exports: _,
        export_specs: _,
        tuple_elems: _,
        mapped: _,
        modifiers: _,
    } = file;
    let mut d = Dump {
        file,
        atoms,
        out: String::new(),
        seen: Default::default(),
    };
    d.list(0, "body", *body, Dump::stmt);

    put!(d, 0, "kind", "{kind:?}");
    put!(d, 0, "has_module_syntax", "{has_module_syntax}");
    put!(
        d,
        0,
        "is_js",
        "{is_js} {check_directive:?} {is_module_by_decree}"
    );
    put!(d, 0, "has_errors", "{has_errors}");
    put!(d, 0, "source_len", "{source_len}");
    put!(d, 0, "legacy_decorators", "{legacy_decorators}");
    put!(d, 0, "syntax_errors", "{syntax_errors}");

    put!(d, 0, "", "references[{}]:", references.len());
    for &(kind, path, pos, mode) in references {
        put!(d, 1, "", "{kind:?} {} pos={pos} mode={mode:?}", d.q(path));
    }

    put!(
        d,
        0,
        "",
        "with_bodies[{}]: {with_bodies:?}",
        with_bodies.len()
    );
    // Only in files with syntax errors.
    if !after_skipped.is_empty() {
        put!(
            d,
            0,
            "",
            "after_skipped[{}]: {after_skipped:?}",
            after_skipped.len()
        );
    }
    if !stray_decorators.is_empty() {
        put!(
            d,
            0,
            "",
            "stray_decorators[{}]: {stray_decorators:?}",
            stray_decorators.len()
        );
    }
    if *has_parse_diagnostics {
        put!(d, 0, "", "has_parse_diagnostics");
    }
    if !checker_errors.is_empty() {
        put!(
            d,
            0,
            "",
            "checker_errors[{}]: {checker_errors:?}",
            checker_errors.len()
        );
    }
    for &(with_pos, attributes) in import_attributes {
        put!(d, 0, "", "import_attributes at {with_pos}:");
        d.expr(1, "attributes", attributes);
    }
    for &specifier in specifier_expressions {
        d.expr(0, "specifier_expression", specifier);
    }

    for &(_, close_pos) in deferred_import_calls {
        put!(d, 0, "", "deferred_import_call close_pos={close_pos}");
    }

    put!(d, 0, "", "suppressed[{}]:", suppressed.len());
    for &(from, to) in suppressed {
        put!(d, 1, "", "{from}..{to}");
    }

    let mut uses: Vec<(u32, String, String)> = specifier_uses
        .iter()
        .map(
            |&SpecifierUse {
                 spec,
                 pos,
                 kind,
                 mode,
             }| (pos, d.q(spec), format!("{kind:?} {mode:?}")),
        )
        .collect();
    uses.sort();
    put!(d, 0, "", "specifier_uses[{}]:", uses.len());
    for (pos, spec, kind) in &uses {
        put!(d, 1, "", "{kind} {spec} pos={pos}");
    }

    let mut errors = early_errors.clone();
    errors.sort_unstable();
    put!(d, 0, "", "early_errors[{}]:", errors.len());
    for (pos, code) in errors {
        put!(d, 1, "", "pos={pos} code={code}");
    }

    let JsxPragmas {
        classic,
        factory,
        fragment_factory,
        import_source,
    } = *jsx_pragmas;
    put!(
        d,
        0,
        "jsx_pragmas",
        "classic={classic:?} factory={} fragment_factory={} import_source={}",
        d.q(factory),
        d.q(fragment_factory),
        d.q(import_source)
    );

    // Only in JavaScript.
    if !jsdoc_comments.is_empty() {
        put!(
            d,
            0,
            "",
            "jsdoc_comments[{}]: {jsdoc_comments:?}",
            jsdoc_comments.len()
        );
    }
    if !jsdoc_errors.is_empty() {
        let mut errors = jsdoc_errors.clone();
        errors.sort_unstable();
        put!(d, 0, "", "jsdoc_errors[{}]: {errors:?}", errors.len());
    }
    for &(owner, ty) in jsdoc_types {
        let (kind, pos) = match owner {
            JsDocTypeOwner::Fn(id) => ("Fn", file.fns.get(id.idx()).map(|func| func.pos)),
            JsDocTypeOwner::Prop(id) => ("Prop", file.props.get(id.idx()).map(|prop| prop.pos)),
            JsDocTypeOwner::Assign(id) => ("Assign", file.exprs.get(id.idx()).map(|expr| expr.pos)),
            JsDocTypeOwner::Export(id) => ("Export", file.stmts.get(id.idx()).map(|stmt| stmt.pos)),
        };
        match pos {
            Some(pos) => put!(d, 0, "", "jsdoc_type of {kind} pos={pos}:"),
            None => put!(d, 0, "", "jsdoc_type of {kind} {NO_SUCH_NODE}:"),
        }
        d.ty(1, "ty", ty);
    }
    for &(expr, flags) in jsdoc_modifiers {
        match file.exprs.get(expr.idx()) {
            Some(expr) => put!(d, 0, "", "jsdoc_modifiers pos={} {flags:?}", expr.pos),
            None => put!(d, 0, "", "jsdoc_modifiers {NO_SUCH_NODE} {flags:?}"),
        }
    }
    for &(func, pos, code) in jsdoc_param_errors {
        match file.fns.get(func.idx()) {
            Some(func) => put!(
                d,
                0,
                "",
                "jsdoc_param_error of Fn pos={} pos={pos} code={code}",
                func.pos
            ),
            None => put!(
                d,
                0,
                "",
                "jsdoc_param_error of Fn {NO_SUCH_NODE} pos={pos} code={code}"
            ),
        }
    }

    // An expression goes by where it starts and what it is.
    let mut around: Vec<(u32, &str, u32)> = parens
        .iter()
        .map(|&(expr, open)| match file.exprs.get(expr.idx()) {
            Some(expr) => (expr.pos, expr_kind_name(expr.kind), open),
            None => (u32::MAX, NO_SUCH_NODE, open),
        })
        .collect();
    around.sort_unstable();
    put!(d, 0, "", "parens[{}]:", around.len());
    for (pos, kind, open) in around {
        put!(d, 1, "", "{kind} pos={pos} open={open}");
    }

    put!(d, 0, "", "decorators[{}]:", decorators.len());
    for &(owner, expr) in decorators {
        let (kind, pos) = match owner {
            DecoratorOwner::Class(id) => {
                ("Class", file.classes.get(id.idx()).map(|class| class.pos))
            }
            DecoratorOwner::Member(id) => (
                "Member",
                file.members.get(id.idx()).map(|member| member.pos),
            ),
            DecoratorOwner::Param(id) => {
                ("Param", file.params.get(id.idx()).map(|param| param.pos))
            }
        };
        match pos {
            Some(pos) => put!(d, 1, "", "{kind} pos={pos}"),
            None => put!(d, 1, "", "{kind} {NO_SUCH_NODE}"),
        }
        d.expr(2, "expr", expr);
    }
    let mut orphans = Vec::new();
    macro_rules! look_for_orphans {
        ($($vector:ident),*) => {$(
            for (i, node) in file.$vector.iter().enumerate() {
                if !d.seen.contains(&(stringify!($vector), i as u32)) {
                    orphans.push(format!("{}[{i}] pos={}", stringify!($vector), node.pos));
                }
            }
        )*};
    }
    look_for_orphans!(types, fns, members, params, type_params, pats, exprs, stmts);
    (d.out, orphans)
}

/// Where two dumps part, `None` if they do not: the number of the line, the six lines before it, and from either side the line and
/// the three after it.
pub fn first_difference(a: &str, b: &str) -> Option<String> {
    if a == b {
        return None;
    }
    let old: Vec<&str> = a.lines().collect();
    let new: Vec<&str> = b.lines().collect();
    let at = old
        .iter()
        .zip(&new)
        .position(|(old, new)| old != new)
        .unwrap_or(old.len().min(new.len()));
    let mut out = String::new();
    let _ = writeln!(out, "line {}:", at + 1);
    for line in &old[at.saturating_sub(6)..at] {
        let _ = writeln!(out, "    {line}");
    }
    for (side, lines) in [("OLD ", &old), ("NEW ", &new)] {
        let _ = writeln!(
            out,
            "{side}{}",
            lines.get(at).copied().unwrap_or("<the end>")
        );
        for line in lines.iter().skip(at + 1).take(3) {
            let _ = writeln!(out, "    {line}");
        }
    }
    Some(out)
}

impl Dump<'_> {
    fn line(&mut self, depth: usize, label: &str, text: &str) {
        for _ in 0..depth {
            self.out.push_str("  ");
        }
        if !label.is_empty() {
            self.out.push_str(label);
            self.out.push_str(": ");
        }
        self.out.push_str(text);
        self.out.push('\n');
    }

    /// A name in quotes, `-` for none.
    fn q(&self, atom: Atom) -> String {
        if atom.is_none() {
            return "-".to_owned();
        }
        let bytes = self.atoms.bytes(atom);
        match std::str::from_utf8(bytes) {
            Ok(text) => format!("{text:?}"),
            Err(_) => format!("b\"{}\"", bytes.escape_ascii()),
        }
    }

    fn number(&self, index: u32) -> String {
        match self.file.numbers.get(index as usize) {
            Some(value) => format!("{value:?}"),
            None => NO_SUCH_NODE.to_owned(),
        }
    }

    fn has_ids<T>(&self, list: IdList<T>) -> bool {
        list.start as usize + list.len() <= self.file.ids.len()
    }

    /// The parts of `A.B.C`, the texts of a template.
    fn names(&self, list: IdList<Atom>) -> String {
        if !self.has_ids(list) {
            return NO_SUCH_NODE.to_owned();
        }
        let mut out = String::from("[");
        for (i, atom) in self.file.ids(list).enumerate() {
            if i > 0 {
                out.push_str(", ");
            }
            out.push_str(&self.q(atom));
        }
        out.push(']');
        out
    }

    /// `label[len]:`. False if what is in the list is not to follow.
    fn open_list(&mut self, depth: usize, label: &str, len: usize) -> bool {
        if depth > MAX_DEPTH {
            self.line(depth, label, "...");
            return false;
        }
        put!(self, depth, "", "{label}[{len}]:");
        true
    }

    fn list<T: From<u32>>(
        &mut self,
        depth: usize,
        label: &str,
        list: IdList<T>,
        each: fn(&mut Self, usize, &str, T),
    ) {
        if !self.open_list(depth, label, list.len()) {
            return;
        }
        if !self.has_ids(list) {
            return self.line(depth + 1, "", NO_SUCH_NODE);
        }
        let file = self.file;
        for id in file.ids(list) {
            each(self, depth + 1, "", id);
        }
    }

    fn span<T: From<u32>>(
        &mut self,
        depth: usize,
        label: &str,
        span: Span<T>,
        each: fn(&mut Self, usize, &str, T),
    ) {
        if !self.open_list(depth, label, span.len()) {
            return;
        }
        for id in span.iter() {
            each(self, depth + 1, "", id);
        }
    }

    fn expr(&mut self, depth: usize, label: &str, id: ExprId) {
        let Expr { kind, pos } = node!(self, depth, label, exprs, id);
        let mut head = format!("Expr {} pos={pos}", expr_kind_name(kind));
        if let Some(end) = self.file.expr_ends.get(id.idx()).filter(|&&end| end != 0) {
            head += &format!(" end={end}");
        }
        let d = depth + 1;
        match kind {
            ExprKind::Missing
            | ExprKind::This
            | ExprKind::Super
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Regex
            | ExprKind::ImportMeta
            | ExprKind::NewTarget => self.line(depth, label, &head),
            ExprKind::Ident(name) | ExprKind::String(name) | ExprKind::BigInt(name) => {
                put!(self, depth, label, "{head} {}", self.q(name))
            }
            ExprKind::Number(index) => put!(self, depth, label, "{head} {}", self.number(index)),
            ExprKind::Template { exprs, texts } => {
                put!(self, depth, label, "{head} texts={}", self.names(texts));
                self.list(d, "exprs", exprs, Self::expr);
            }
            ExprKind::TaggedTemplate(call) | ExprKind::Call(call) | ExprKind::New(call) => {
                self.line(depth, label, &head);
                self.call(d, "call", call);
            }
            ExprKind::Array(items) => {
                self.line(depth, label, &head);
                self.list(d, "items", items, Self::expr);
            }
            ExprKind::Object(props) => {
                self.line(depth, label, &head);
                self.span(d, "props", props, Self::prop);
            }
            ExprKind::Fn(func) => {
                self.line(depth, label, &head);
                self.func(d, "func", func);
            }
            ExprKind::Class(class) => {
                self.line(depth, label, &head);
                self.class(d, "class", class);
            }
            ExprKind::Dot {
                obj,
                name,
                name_pos,
                chain,
            } => {
                put!(
                    self,
                    depth,
                    label,
                    "{head} name={} name_pos={name_pos} chain={chain:?}",
                    self.q(name)
                );
                self.expr(d, "obj", obj);
            }
            ExprKind::Index { obj, index, chain } => {
                put!(self, depth, label, "{head} chain={chain:?}");
                self.expr(d, "obj", obj);
                self.expr(d, "index", index);
            }
            ExprKind::Unary { op, operand } => {
                put!(self, depth, label, "{head} op={op:?}");
                self.expr(d, "operand", operand);
            }
            ExprKind::Binary { op, left, right } => {
                put!(self, depth, label, "{head} op={op:?}");
                self.expr(d, "left", left);
                self.expr(d, "right", right);
            }
            ExprKind::Assign { op, target, value } => {
                put!(self, depth, label, "{head} op={op:?}");
                self.expr(d, "target", target);
                self.expr(d, "value", value);
            }
            ExprKind::Cond { test, yes, no } => {
                self.line(depth, label, &head);
                self.expr(d, "test", test);
                self.expr(d, "yes", yes);
                self.expr(d, "no", no);
            }
            ExprKind::Spread(expr)
            | ExprKind::Await(expr)
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr) => {
                self.line(depth, label, &head);
                self.expr(d, "expr", expr);
            }
            ExprKind::ImportCall(specifier, more) => {
                self.line(depth, label, &head);
                self.expr(d, "specifier", specifier);
                self.list(d, "more", more, Self::expr);
            }
            ExprKind::Instantiation { expr, type_args } => {
                self.line(depth, label, &head);
                self.expr(d, "expr", expr);
                self.list(d, "type_args", type_args, Self::ty);
            }
            ExprKind::Yield { value, star } => {
                put!(self, depth, label, "{head} star={star}");
                self.expr(d, "value", value);
            }
            ExprKind::As { expr, ty } | ExprKind::Satisfies { expr, ty } => {
                self.line(depth, label, &head);
                self.expr(d, "expr", expr);
                self.ty(d, "ty", ty);
            }
            ExprKind::Jsx(jsx) => {
                self.line(depth, label, &head);
                self.jsx(d, "jsx", jsx);
            }
        }
    }

    fn call(&mut self, depth: usize, label: &str, id: CallId) {
        let Call {
            callee,
            args,
            type_args,
            close_pos,
            chain,
            template,
        } = node!(self, depth, label, calls, id);
        put!(
            self,
            depth,
            label,
            "Call close_pos={close_pos} chain={chain:?}"
        );
        let d = depth + 1;
        self.expr(d, "callee", callee);
        self.list(d, "type_args", type_args, Self::ty);
        self.list(d, "args", args, Self::expr);
        if template.is_some() {
            self.expr(d, "template", template);
        }
    }

    fn key(&mut self, depth: usize, label: &str, key: PropKey) {
        match key {
            PropKey::None => self.line(depth, label, "None"),
            PropKey::Name(name) => put!(self, depth, label, "Name {}", self.q(name)),
            PropKey::Private(name) => put!(self, depth, label, "Private {}", self.q(name)),
            PropKey::Computed(expr) => {
                self.line(depth, label, "Computed");
                self.expr(depth + 1, "expr", expr);
            }
        }
    }

    fn prop(&mut self, depth: usize, label: &str, id: PropId) {
        let Prop {
            kind,
            key,
            value,
            pos,
            start,
            end,
        } = node!(self, depth, label, props, id);
        put!(
            self,
            depth,
            label,
            "Prop kind={} pos={pos} start={start} end={end}",
            prop_kind_name(kind)
        );
        let d = depth + 1;
        self.key(d, "key", key);
        self.expr(d, "value", value);
    }

    fn jsx(&mut self, depth: usize, label: &str, id: JsxId) {
        let Jsx {
            tag,
            attrs,
            children,
            type_args,
            opening_end,
            close_pos,
            end,
            close_tag,
        } = node!(self, depth, label, jsx, id);
        put!(
            self,
            depth,
            label,
            "Jsx opening_end={opening_end} close_pos={close_pos} end={end}"
        );
        let d = depth + 1;
        self.expr(d, "tag", tag);
        self.expr(d, "close_tag", close_tag);
        self.list(d, "type_args", type_args, Self::ty);
        self.span(d, "attrs", attrs, Self::prop);
        self.list(d, "children", children, Self::expr);
    }

    fn pat(&mut self, depth: usize, label: &str, id: PatId) {
        let Pat { kind, pos } = node!(self, depth, label, pats, id);
        match kind {
            PatKind::Missing => put!(self, depth, label, "Pat Missing pos={pos}"),
            PatKind::Ident(name) => {
                put!(self, depth, label, "Pat Ident pos={pos} {}", self.q(name))
            }
            PatKind::Object(props) => {
                put!(self, depth, label, "Pat Object pos={pos}");
                self.span(depth + 1, "props", props, Self::pat_prop);
            }
            PatKind::Array(elems) => {
                put!(self, depth, label, "Pat Array pos={pos}");
                self.span(depth + 1, "elems", elems, Self::pat_elem);
            }
        }
    }

    fn pat_prop(&mut self, depth: usize, label: &str, id: PatPropId) {
        let PatProp {
            key,
            value,
            default,
            is_rest,
            pos,
            key_pos,
        } = node!(self, depth, label, pat_props, id);
        put!(
            self,
            depth,
            label,
            "PatProp is_rest={is_rest} pos={pos} key_pos={key_pos}"
        );
        let d = depth + 1;
        self.key(d, "key", key);
        self.pat(d, "value", value);
        self.expr(d, "default", default);
    }

    fn pat_elem(&mut self, depth: usize, label: &str, id: PatElemId) {
        let PatElem {
            pat,
            default,
            is_rest,
            start,
        } = node!(self, depth, label, pat_elems, id);
        put!(
            self,
            depth,
            label,
            "PatElem is_rest={is_rest} start={start}"
        );
        let d = depth + 1;
        self.pat(d, "pat", pat);
        self.expr(d, "default", default);
    }

    fn var_decl(&mut self, depth: usize, label: &str, id: VarDeclId) {
        let VarDecl {
            pat,
            ty,
            init,
            kind,
            flags,
        } = node!(self, depth, label, var_decls, id);
        put!(self, depth, label, "VarDecl kind={kind:?} flags={flags:?}");
        let d = depth + 1;
        self.pat(d, "pat", pat);
        self.ty(d, "ty", ty);
        self.expr(d, "init", init);
    }

    fn stmt(&mut self, depth: usize, label: &str, id: StmtId) {
        let Stmt {
            kind,
            pos,
            start,
            loc,
            modifiers,
        } = node!(self, depth, label, stmts, id);
        let mut head = format!(
            "Stmt {} pos={pos} start={start} loc={}..{}",
            stmt_kind_name(kind),
            loc.pos,
            loc.end
        );
        for modifier in self.file.modifier_list(modifiers) {
            head += &format!(" {:?}@{}", modifier.kind, modifier.pos);
        }
        let d = depth + 1;
        match kind {
            StmtKind::Empty => self.line(depth, label, &head),
            StmtKind::Expr(expr)
            | StmtKind::Return(expr)
            | StmtKind::Throw(expr)
            | StmtKind::ExportDefault(expr)
            | StmtKind::ExportAssign(expr) => {
                self.line(depth, label, &head);
                self.expr(d, "expr", expr);
            }
            StmtKind::Var(decls) => {
                self.line(depth, label, &head);
                self.span(d, "decls", decls, Self::var_decl);
            }
            StmtKind::Fn(func) => {
                self.line(depth, label, &head);
                self.func(d, "func", func);
            }
            StmtKind::Class(class) => {
                self.line(depth, label, &head);
                self.class(d, "class", class);
            }
            StmtKind::Interface(interface) => {
                self.line(depth, label, &head);
                self.interface(d, "interface", interface);
            }
            StmtKind::TypeAlias(alias) => {
                self.line(depth, label, &head);
                self.alias(d, "alias", alias);
            }
            StmtKind::Enum(decl) => {
                self.line(depth, label, &head);
                self.enum_decl(d, "enum", decl);
            }
            StmtKind::Module(module) => {
                self.line(depth, label, &head);
                self.module(d, "module", module);
            }
            StmtKind::If { test, yes, no } => {
                self.line(depth, label, &head);
                self.expr(d, "test", test);
                self.stmt(d, "yes", yes);
                self.stmt(d, "no", no);
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                self.line(depth, label, &head);
                self.stmt(d, "init", init);
                self.expr(d, "test", test);
                self.expr(d, "update", update);
                self.stmt(d, "body", body);
            }
            StmtKind::ForIn { left, expr, body } => {
                self.line(depth, label, &head);
                self.stmt(d, "left", left);
                self.expr(d, "expr", expr);
                self.stmt(d, "body", body);
            }
            StmtKind::ForOf {
                left,
                expr,
                body,
                is_await,
            } => {
                put!(self, depth, label, "{head} is_await={is_await}");
                self.stmt(d, "left", left);
                self.expr(d, "expr", expr);
                self.stmt(d, "body", body);
            }
            StmtKind::While { test, body } => {
                self.line(depth, label, &head);
                self.expr(d, "test", test);
                self.stmt(d, "body", body);
            }
            StmtKind::DoWhile { body, test } => {
                self.line(depth, label, &head);
                self.stmt(d, "body", body);
                self.expr(d, "test", test);
            }
            StmtKind::Block(stmts) => {
                self.line(depth, label, &head);
                self.list(d, "stmts", stmts, Self::stmt);
            }
            StmtKind::Switch { expr, cases } => {
                self.line(depth, label, &head);
                self.expr(d, "expr", expr);
                self.span(d, "cases", cases, Self::case);
            }
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                self.line(depth, label, &head);
                self.stmt(d, "block", block);
                self.var_decl(d, "param", param);
                self.stmt(d, "handler", handler);
                self.stmt(d, "finalizer", finalizer);
            }
            StmtKind::Break(name)
            | StmtKind::Continue(name)
            | StmtKind::ExportAsNamespace(name) => {
                put!(self, depth, label, "{head} {}", self.q(name));
            }
            StmtKind::Labeled { label: name, body } => {
                put!(self, depth, label, "{head} label={}", self.q(name));
                self.stmt(d, "body", body);
            }
            StmtKind::Import(import) => {
                self.line(depth, label, &head);
                self.import(d, "import", import);
            }
            StmtKind::ImportEquals(import) => {
                self.line(depth, label, &head);
                self.import_equals(d, "import", import);
            }
            StmtKind::ExportNamed(export) => {
                self.line(depth, label, &head);
                self.export(d, "export", export);
            }
            StmtKind::ExportStar {
                spec,
                alias,
                type_only,
                mode,
                star_pos,
                alias_pos,
            } => {
                put!(
                    self,
                    depth,
                    label,
                    "{head} spec={} alias={} type_only={type_only} mode={mode:?} star_pos={star_pos} alias_pos={alias_pos}",
                    self.q(spec),
                    self.q(alias)
                )
            }
        }
    }

    fn case(&mut self, depth: usize, label: &str, id: CaseId) {
        let Case { test, body, pos } = node!(self, depth, label, cases, id);
        put!(self, depth, label, "Case pos={pos}");
        let d = depth + 1;
        self.expr(d, "test", test);
        self.list(d, "body", body, Self::stmt);
    }

    fn func(&mut self, depth: usize, label: &str, id: FnId) {
        let Func {
            kind,
            flags,
            name,
            name_pos,
            type_params,
            params,
            this_param,
            ret,
            body,
            anchor,
            pos,
            start,
        } = node!(self, depth, label, fns, id);
        put!(
            self,
            depth,
            label,
            "Func kind={kind:?} flags={flags:?} name={} name_pos={name_pos} anchor={anchor} pos={pos} start={start}",
            self.q(name)
        );
        let d = depth + 1;
        self.span(d, "type_params", type_params, Self::type_param);
        self.span(d, "params", params, Self::param);
        if this_param.is_some() {
            self.param(d, "this_param", this_param);
        }
        self.ty(d, "ret", ret);
        match body {
            FnBody::None => self.line(d, "body", "None"),
            FnBody::Block(stmts) => {
                self.line(d, "body", "Block");
                self.list(d + 1, "stmts", stmts, Self::stmt);
            }
            FnBody::Expr(expr) => {
                self.line(d, "body", "Expr");
                self.expr(d + 1, "expr", expr);
            }
        }
    }

    fn param(&mut self, depth: usize, label: &str, id: ParamId) {
        let Param {
            pat,
            ty,
            default,
            flags,
            pos,
            end,
        } = node!(self, depth, label, params, id);
        put!(
            self,
            depth,
            label,
            "Param flags={flags:?} pos={pos} end={end}"
        );
        let d = depth + 1;
        self.pat(d, "pat", pat);
        self.ty(d, "ty", ty);
        self.expr(d, "default", default);
    }

    fn type_param(&mut self, depth: usize, label: &str, id: TypeParamId) {
        let TypeParam {
            name,
            pos,
            start,
            end,
            constraint,
            default,
            flags,
        } = node!(self, depth, label, type_params, id);
        put!(
            self,
            depth,
            label,
            "TypeParam name={} pos={pos} start={start} end={end} flags={flags:?}",
            self.q(name)
        );
        let d = depth + 1;
        self.ty(d, "constraint", constraint);
        self.ty(d, "default", default);
    }

    fn member(&mut self, depth: usize, label: &str, id: MemberId) {
        let Member {
            kind,
            key,
            flags,
            ty,
            init,
            func,
            pos,
            start,
            loc,
            modifiers,
        } = node!(self, depth, label, members, id);
        let mut head = format!(
            "Member kind={} flags={flags:?} pos={pos} start={start} loc={}..{}",
            member_kind_name(kind),
            loc.pos,
            loc.end
        );
        for modifier in self.file.modifier_list(modifiers) {
            head += &format!(" {:?}@{}", modifier.kind, modifier.pos);
        }
        self.line(depth, label, &head);
        let d = depth + 1;
        self.key(d, "key", key);
        self.ty(d, "ty", ty);
        self.expr(d, "init", init);
        self.func(d, "func", func);
    }

    fn class(&mut self, depth: usize, label: &str, id: ClassId) {
        let Class {
            name,
            name_pos,
            flags,
            type_params,
            extends,
            extends_args,
            other_extends,
            implements,
            other_implements,
            members,
            pos,
            start,
        } = node!(self, depth, label, classes, id);
        put!(
            self,
            depth,
            label,
            "Class name={} name_pos={name_pos} flags={flags:?} pos={pos} start={start}",
            self.q(name)
        );
        let d = depth + 1;
        self.span(d, "type_params", type_params, Self::type_param);
        self.expr(d, "extends", extends);
        self.list(d, "extends_args", extends_args, Self::ty);
        self.list(d, "other_extends", other_extends, Self::expr);
        self.list(d, "implements", implements, Self::ty);
        self.list(d, "other_implements", other_implements, Self::ty);
        self.span(d, "members", members, Self::member);
    }

    fn interface(&mut self, depth: usize, label: &str, id: InterfaceId) {
        let Interface {
            name,
            name_pos,
            flags,
            type_params,
            extends,
            other_heritage,
            members,
            stmt: _,
        } = node!(self, depth, label, interfaces, id);
        put!(
            self,
            depth,
            label,
            "Interface name={} name_pos={name_pos} flags={flags:?}",
            self.q(name)
        );
        let d = depth + 1;
        self.span(d, "type_params", type_params, Self::type_param);
        self.list(d, "extends", extends, Self::ty);
        self.list(d, "other_heritage", other_heritage, Self::ty);
        self.span(d, "members", members, Self::member);
    }

    fn alias(&mut self, depth: usize, label: &str, id: AliasId) {
        let Alias {
            name,
            name_pos,
            flags,
            type_params,
            ty,
            stmt: _,
        } = node!(self, depth, label, aliases, id);
        put!(
            self,
            depth,
            label,
            "Alias name={} name_pos={name_pos} flags={flags:?}",
            self.q(name)
        );
        let d = depth + 1;
        self.span(d, "type_params", type_params, Self::type_param);
        self.ty(d, "ty", ty);
    }

    fn enum_decl(&mut self, depth: usize, label: &str, id: EnumId) {
        let Enum {
            name,
            name_pos,
            flags,
            members,
            stmt: _,
        } = node!(self, depth, label, enums, id);
        put!(
            self,
            depth,
            label,
            "Enum name={} name_pos={name_pos} flags={flags:?}",
            self.q(name)
        );
        self.span(depth + 1, "members", members, Self::enum_member);
    }

    fn enum_member(&mut self, depth: usize, label: &str, id: EnumMemberId) {
        let EnumMember {
            name,
            computed_name,
            init,
            pos,
        } = node!(self, depth, label, enum_members, id);
        put!(
            self,
            depth,
            label,
            "EnumMember name={} pos={pos}",
            self.q(name)
        );
        self.expr(depth + 1, "computed_name", computed_name);
        self.expr(depth + 1, "init", init);
    }

    fn module(&mut self, depth: usize, label: &str, id: ModuleId) {
        let Module {
            name,
            name_pos,
            flags,
            body,
            has_body,
            stmt: _,
        } = node!(self, depth, label, modules, id);
        let name = match name {
            ModuleName::Ident(name) => format!("Ident {}", self.q(name)),
            ModuleName::String(name) => format!("String {}", self.q(name)),
            ModuleName::Global => "Global".to_owned(),
        };
        put!(
            self,
            depth,
            label,
            "Module name={name} name_pos={name_pos} flags={flags:?} has_body={has_body}"
        );
        self.list(depth + 1, "body", body, Self::stmt);
    }

    fn import(&mut self, depth: usize, label: &str, id: ImportId) {
        let Import {
            spec,
            default,
            default_pos,
            namespace,
            namespace_pos,
            clause_start,
            namespace_start,
            named,
            type_only,
            mode,
        } = node!(self, depth, label, imports, id);
        put!(
            self,
            depth,
            label,
            "Import spec={} default={} default_pos={default_pos} namespace={} namespace_pos={namespace_pos} clause_start={clause_start} namespace_start={namespace_start} type_only={type_only} mode={mode:?}",
            self.q(spec),
            self.q(default),
            self.q(namespace)
        );
        self.span(depth + 1, "named", named, Self::import_spec);
    }

    fn import_spec(&mut self, depth: usize, label: &str, id: ImportSpecId) {
        let ImportSpec {
            start,
            imported,
            local,
            pos,
            type_only,
            imported_pos,
            import: _,
        } = node!(self, depth, label, import_specs, id);
        put!(
            self,
            depth,
            label,
            "ImportSpec imported={} local={} pos={pos} type_only={type_only} imported_pos={imported_pos} start={start}",
            self.q(imported),
            self.q(local)
        );
    }

    fn import_equals(&mut self, depth: usize, label: &str, id: ImportEqualsId) {
        let ImportEquals {
            name,
            name_pos,
            target,
            flags,
            stmt: _,
        } = node!(self, depth, label, import_equals, id);
        let target = match target {
            ImportEqualsTarget::Require(spec) => format!("Require {}", self.q(spec)),
            ImportEqualsTarget::Entity(name) => format!("Entity {}", self.names(name)),
        };
        put!(
            self,
            depth,
            label,
            "ImportEquals name={} name_pos={name_pos} target={target} flags={flags:?}",
            self.q(name)
        );
    }

    fn export(&mut self, depth: usize, label: &str, id: ExportId) {
        let Export {
            spec,
            items,
            type_only,
            mode,
        } = node!(self, depth, label, exports, id);
        put!(
            self,
            depth,
            label,
            "Export spec={} type_only={type_only} mode={mode:?}",
            self.q(spec)
        );
        self.span(depth + 1, "items", items, Self::export_spec);
    }

    fn export_spec(&mut self, depth: usize, label: &str, id: ExportSpecId) {
        let ExportSpec {
            start,
            local,
            exported,
            pos,
            type_only,
            local_pos,
            export: _,
        } = node!(self, depth, label, export_specs, id);
        put!(
            self,
            depth,
            label,
            "ExportSpec local={} exported={} pos={pos} type_only={type_only} local_pos={local_pos} start={start}",
            self.q(local),
            self.q(exported)
        );
    }

    fn ty(&mut self, depth: usize, label: &str, id: TypeNodeId) {
        let TypeNode { kind, pos, end } = node!(self, depth, label, types, id);
        let head = format!("TypeNode {} pos={pos} end={end}", type_kind_name(kind));
        let d = depth + 1;
        match kind {
            TypeNodeKind::Error | TypeNodeKind::UniqueSymbol => self.line(depth, label, &head),
            TypeNodeKind::Heritage(expr) => {
                self.line(depth, label, &head);
                self.expr(d, "expr", expr);
            }
            TypeNodeKind::Keyword(keyword) => put!(self, depth, label, "{head} {keyword:?}"),
            TypeNodeKind::Ref { name, args } => {
                put!(self, depth, label, "{head} name={}", self.names(name));
                self.list(d, "args", args, Self::ty);
            }
            TypeNodeKind::StringLit(text) => put!(self, depth, label, "{head} {}", self.q(text)),
            TypeNodeKind::NumberLit(index) => {
                put!(self, depth, label, "{head} {}", self.number(index))
            }
            TypeNodeKind::BigIntLit { text, negative } => put!(
                self,
                depth,
                label,
                "{head} text={} negative={negative}",
                self.q(text)
            ),
            TypeNodeKind::BoolLit(value) => put!(self, depth, label, "{head} {value}"),
            TypeNodeKind::Template { types, texts } => {
                put!(self, depth, label, "{head} texts={}", self.names(texts));
                self.list(d, "types", types, Self::ty);
            }
            TypeNodeKind::Array(ty) | TypeNodeKind::Keyof(ty) | TypeNodeKind::Readonly(ty) => {
                self.line(depth, label, &head);
                self.ty(d, "ty", ty);
            }
            TypeNodeKind::Tuple(elems) => {
                self.line(depth, label, &head);
                self.span(d, "elems", elems, Self::tuple_elem);
            }
            TypeNodeKind::Union(types) | TypeNodeKind::Intersection(types) => {
                self.line(depth, label, &head);
                self.list(d, "types", types, Self::ty);
            }
            TypeNodeKind::Fn(func) => {
                self.line(depth, label, &head);
                self.func(d, "func", func);
            }
            TypeNodeKind::Object(members) => {
                self.line(depth, label, &head);
                self.span(d, "members", members, Self::member);
            }
            TypeNodeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => {
                self.line(depth, label, &head);
                self.ty(d, "check", check);
                self.ty(d, "extends", extends);
                self.ty(d, "yes", yes);
                self.ty(d, "no", no);
            }
            TypeNodeKind::Infer(param) => {
                self.line(depth, label, &head);
                self.type_param(d, "param", param);
            }
            TypeNodeKind::Mapped(mapped) => {
                self.line(depth, label, &head);
                self.mapped(d, "mapped", mapped);
            }
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.line(depth, label, &head);
                self.ty(d, "obj", obj);
                self.ty(d, "index", index);
            }
            TypeNodeKind::Typeof { name, args, expr } => {
                put!(self, depth, label, "{head} name={}", self.names(name));
                self.list(d, "args", args, Self::ty);
                self.expr(d, "expr", expr);
            }
            TypeNodeKind::Import {
                spec,
                name,
                args,
                is_typeof,
                mode,
            } => {
                put!(
                    self,
                    depth,
                    label,
                    "{head} spec={} name={} is_typeof={is_typeof} mode={mode:?}",
                    self.q(spec),
                    self.names(name)
                );
                self.list(d, "args", args, Self::ty);
            }
            TypeNodeKind::Predicate { param, ty, asserts } => {
                put!(
                    self,
                    depth,
                    label,
                    "{head} param={} asserts={asserts}",
                    self.q(param)
                );
                self.ty(d, "ty", ty);
            }
        }
    }

    fn mapped(&mut self, depth: usize, label: &str, id: MappedId) {
        let Mapped {
            param,
            name_ty,
            ty,
            readonly,
            optional,
            members,
        } = node!(self, depth, label, mapped, id);
        put!(
            self,
            depth,
            label,
            "Mapped readonly={readonly:?} optional={optional:?}"
        );
        let d = depth + 1;
        self.type_param(d, "param", param);
        self.ty(d, "name_ty", name_ty);
        self.ty(d, "ty", ty);
        self.span(d, "members", members, Self::member);
    }

    fn tuple_elem(&mut self, depth: usize, label: &str, id: TupleElemId) {
        let TupleElem {
            ty,
            name,
            optional,
            rest,
        } = node!(self, depth, label, tuple_elems, id);
        put!(
            self,
            depth,
            label,
            "TupleElem name={} optional={optional} rest={rest}",
            self.q(name)
        );
        self.ty(depth + 1, "ty", ty);
    }
}

fn expr_kind_name(kind: ExprKind) -> &'static str {
    match kind {
        ExprKind::Missing => "Missing",
        ExprKind::Instantiation { .. } => "Instantiation",
        ExprKind::Ident(_) => "Ident",
        ExprKind::This => "This",
        ExprKind::Super => "Super",
        ExprKind::Null => "Null",
        ExprKind::True => "True",
        ExprKind::False => "False",
        ExprKind::Number(_) => "Number",
        ExprKind::String(_) => "String",
        ExprKind::BigInt(_) => "BigInt",
        ExprKind::Regex => "Regex",
        ExprKind::Template { .. } => "Template",
        ExprKind::TaggedTemplate(_) => "TaggedTemplate",
        ExprKind::Array(_) => "Array",
        ExprKind::Object(_) => "Object",
        ExprKind::Fn(_) => "Fn",
        ExprKind::Class(_) => "Class",
        ExprKind::Dot { .. } => "Dot",
        ExprKind::Index { .. } => "Index",
        ExprKind::Call(_) => "Call",
        ExprKind::New(_) => "New",
        ExprKind::Unary { .. } => "Unary",
        ExprKind::Binary { .. } => "Binary",
        ExprKind::Assign { .. } => "Assign",
        ExprKind::Cond { .. } => "Cond",
        ExprKind::Spread(_) => "Spread",
        ExprKind::Await(_) => "Await",
        ExprKind::Yield { .. } => "Yield",
        ExprKind::As { .. } => "As",
        ExprKind::Satisfies { .. } => "Satisfies",
        ExprKind::AsConst(_) => "AsConst",
        ExprKind::NonNull(_) => "NonNull",
        ExprKind::Jsx(_) => "Jsx",
        ExprKind::ImportCall(..) => "ImportCall",
        ExprKind::ImportMeta => "ImportMeta",
        ExprKind::NewTarget => "NewTarget",
    }
}

fn stmt_kind_name(kind: StmtKind) -> &'static str {
    match kind {
        StmtKind::Empty => "Empty",
        StmtKind::Expr(_) => "Expr",
        StmtKind::Var(_) => "Var",
        StmtKind::Fn(_) => "Fn",
        StmtKind::Class(_) => "Class",
        StmtKind::Interface(_) => "Interface",
        StmtKind::TypeAlias(_) => "TypeAlias",
        StmtKind::Enum(_) => "Enum",
        StmtKind::Module(_) => "Module",
        StmtKind::Return(_) => "Return",
        StmtKind::If { .. } => "If",
        StmtKind::For { .. } => "For",
        StmtKind::ForIn { .. } => "ForIn",
        StmtKind::ForOf { .. } => "ForOf",
        StmtKind::While { .. } => "While",
        StmtKind::DoWhile { .. } => "DoWhile",
        StmtKind::Block(_) => "Block",
        StmtKind::Switch { .. } => "Switch",
        StmtKind::Try { .. } => "Try",
        StmtKind::Throw(_) => "Throw",
        StmtKind::Break(_) => "Break",
        StmtKind::Continue(_) => "Continue",
        StmtKind::Labeled { .. } => "Labeled",
        StmtKind::Import(_) => "Import",
        StmtKind::ImportEquals(_) => "ImportEquals",
        StmtKind::ExportNamed(_) => "ExportNamed",
        StmtKind::ExportStar { .. } => "ExportStar",
        StmtKind::ExportDefault(_) => "ExportDefault",
        StmtKind::ExportAssign(_) => "ExportAssign",
        StmtKind::ExportAsNamespace(_) => "ExportAsNamespace",
    }
}

fn type_kind_name(kind: TypeNodeKind) -> &'static str {
    match kind {
        TypeNodeKind::Error => "Error",
        TypeNodeKind::Heritage(_) => "Heritage",
        TypeNodeKind::Keyword(_) => "Keyword",
        TypeNodeKind::Ref { .. } => "Ref",
        TypeNodeKind::StringLit(_) => "StringLit",
        TypeNodeKind::NumberLit(_) => "NumberLit",
        TypeNodeKind::BigIntLit { .. } => "BigIntLit",
        TypeNodeKind::BoolLit(_) => "BoolLit",
        TypeNodeKind::Template { .. } => "Template",
        TypeNodeKind::Array(_) => "Array",
        TypeNodeKind::Tuple(_) => "Tuple",
        TypeNodeKind::Union(_) => "Union",
        TypeNodeKind::Intersection(_) => "Intersection",
        TypeNodeKind::Fn(_) => "Fn",
        TypeNodeKind::Object(_) => "Object",
        TypeNodeKind::Cond { .. } => "Cond",
        TypeNodeKind::Infer(_) => "Infer",
        TypeNodeKind::Mapped(_) => "Mapped",
        TypeNodeKind::IndexedAccess { .. } => "IndexedAccess",
        TypeNodeKind::Keyof(_) => "Keyof",
        TypeNodeKind::Readonly(_) => "Readonly",
        TypeNodeKind::UniqueSymbol => "UniqueSymbol",
        TypeNodeKind::Typeof { .. } => "Typeof",
        TypeNodeKind::Import { .. } => "Import",
        TypeNodeKind::Predicate { .. } => "Predicate",
    }
}

fn prop_kind_name(kind: PropKind) -> &'static str {
    match kind {
        PropKind::Init => "Init",
        PropKind::Shorthand => "Shorthand",
        PropKind::Spread => "Spread",
        PropKind::Method => "Method",
        PropKind::Getter => "Getter",
        PropKind::Setter => "Setter",
    }
}

fn member_kind_name(kind: MemberKind) -> &'static str {
    match kind {
        MemberKind::Property => "Property",
        MemberKind::Method => "Method",
        MemberKind::Getter => "Getter",
        MemberKind::Setter => "Setter",
        MemberKind::Constructor => "Constructor",
        MemberKind::CallSignature => "CallSignature",
        MemberKind::ConstructSignature => "ConstructSignature",
        MemberKind::IndexSignature => "IndexSignature",
        MemberKind::StaticBlock => "StaticBlock",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `a + (1);`. `shuffled` pushes the operands the other way round, after nodes that nothing names.
    fn sum(atoms: &Interner, shuffled: bool, pos_of_one: u32) -> File {
        let mut file = File::default();
        let a = ExprKind::Ident(atoms.intern_str("a"));
        let (left, right) = if shuffled {
            file.expr(ExprKind::Null, 99);
            file.number(7.0);
            let one = file.number(1.0);
            let right = file.expr(ExprKind::Number(one), pos_of_one);
            (file.expr(a, 0), right)
        } else {
            let left = file.expr(a, 0);
            let one = file.number(1.0);
            (left, file.expr(ExprKind::Number(one), pos_of_one))
        };
        let sum = file.expr(
            ExprKind::Binary {
                op: BinOp::Add,
                left,
                right,
            },
            0,
        );
        let stmt = file.stmt(StmtKind::Expr(sum), 0);
        file.body = file.list(&[stmt]);
        file.parens.push((right, 4));
        file
    }

    #[test]
    fn the_order_of_the_nodes_does_not_show() {
        let atoms = Interner::new();
        let old = dump(&sum(&atoms, false, 5), &atoms);
        let new = dump(&sum(&atoms, true, 5), &atoms);
        assert_eq!(first_difference(&old, &new), None);
    }

    #[test]
    fn a_position_shows() {
        let atoms = Interner::new();
        let old = dump(&sum(&atoms, false, 5), &atoms);
        let new = dump(&sum(&atoms, true, 6), &atoms);
        let report = first_difference(&old, &new).unwrap();
        assert!(
            report
                .lines()
                .any(|l| l.starts_with("OLD ") && l.ends_with("right: Expr Number pos=5 1.0")),
            "{report}"
        );
        assert!(
            report
                .lines()
                .any(|l| l.starts_with("NEW ") && l.ends_with("right: Expr Number pos=6 1.0")),
            "{report}"
        );
    }

    #[test]
    fn a_tree_that_holds_itself_ends() {
        let work = || {
            let mut file = File::default();
            let block = file.stmt(StmtKind::Empty, 0);
            let inside = file.list(&[block]);
            file[block].kind = StmtKind::Block(inside);
            file.body = inside;
            dump(&file, &Interner::new())
        };
        let text = std::thread::Builder::new()
            .stack_size(256 << 20)
            .spawn(work)
            .unwrap()
            .join()
            .unwrap();
        assert!(text.contains("...\n"));
    }
}
