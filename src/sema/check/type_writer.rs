//! The type at every expression and declaration name of a file: what TypeScript's test harness writes into `.types` baselines
//! (`typeWriterWalker`, `GetTypeAtLocation`).

use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, SymbolId};

/// `typeWriterResult`
pub struct TypeAtLocation {
    pub start: u32,
    pub end: u32,
    pub type_text: String,
    /// What kind of node it is, for telling apart where a difference comes from.
    pub kind: &'static str,
}

impl Checker<'_> {
    /// `typeWriterWalker.getTypes`, in no particular order. The file must have been checked, as in the harness.
    pub fn types_at_locations(&mut self, file: FileId) -> Vec<TypeAtLocation> {
        let hir = self.hir(file);
        let mut results = Vec::with_capacity(hir.exprs.len() * 2);
        let mut text_of_expr: Vec<Option<String>> = vec![None; hir.exprs.len()];
        // `IsExpressionWithTypeArgumentsInClassExtendsClause`: the harness writes the base type there, not the type of the expression.
        let mut extended: Vec<ExprId> = hir.classes.iter().map(|class| class.extends).collect();
        // A shorthand property is one node, which is written as a name.
        extended.extend(
            hir.props
                .iter()
                .filter(|prop| matches!(prop.kind, PropKind::Shorthand))
                .map(|prop| prop.value),
        );
        for index in 0..hir.exprs.len() {
            let e = ExprId(index as u32);
            let expr = hir[e];
            // `checkSpreadExpression` gives a spread element the type of what is iterated over, which `type_of_expr` does not.
            if matches!(expr.kind, ExprKind::Missing | ExprKind::Spread(_)) || extended.contains(&e)
            {
                continue;
            }
            // `getRegularTypeOfExpression`
            let ty = self.type_of_expr(file, e);
            let ty = self.regular(ty);
            let type_text = self.type_to_string_for_baseline(ty);
            // `isRightSideOfQualifiedNameOrPropertyAccess`: the name has the type of the whole access.
            if let ExprKind::Dot { name, name_pos, .. } = expr.kind {
                results.push(TypeAtLocation {
                    start: name_pos,
                    end: name_pos + self.atom_text(name).len() as u32,
                    type_text: type_text.clone(),
                    kind: "access-name",
                });
            }
            results.push(TypeAtLocation {
                start: self.start_inside_parentheses(file, e),
                end: self.end_inside_parentheses(file, e),
                type_text: type_text.clone(),
                kind: "expression",
            });
            text_of_expr[index] = Some(type_text);
        }
        for &(e, open) in &hir.parens {
            if let Some(type_text) = &text_of_expr[e.idx()] {
                results.push(TypeAtLocation {
                    start: open,
                    end: self.end_of_expr_from(file, e, open),
                    type_text: type_text.clone(),
                    kind: "parenthesized",
                });
            }
        }
        for index in 0..hir.pats.len() {
            let pat = PatId(index as u32);
            let PatKind::Ident(name) = hir[pat].kind else {
                continue;
            };
            let ty = self.type_of_pat(file, pat);
            results.push(TypeAtLocation {
                start: hir[pat].pos,
                end: hir[pat].pos + self.atom_text(name).len() as u32,
                type_text: self.type_to_string_for_baseline(ty),
                kind: "variable",
            });
        }
        self.types_at_declaration_names(file, &mut results);
        self.types_at_member_names(file, &mut results);
        self.types_at_property_names(file, &mut results);
        results
    }

    /// `getTypeOfNode` of the names of the declarations that have a symbol of their own.
    fn types_at_declaration_names(&mut self, file: FileId, results: &mut Vec<TypeAtLocation>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for index in 0..bound.symbols.len() {
            let sym = self.files().sym(file, SymbolId(index as u32));
            for &decl in bound.symbols[index].decls.as_slice() {
                // `isTypeDeclarationName`: the declared type. Otherwise the type of the symbol.
                let (name, is_type_declaration) = match decl {
                    Decl::Class(c) => (hir[c].name, true),
                    Decl::Enum(e) => (hir[e].name, true),
                    Decl::Alias(a) => (hir[a].name, true),
                    Decl::Fn(f) => (hir[f].name, false),
                    Decl::EnumMember(m) => (hir[m].name, false),
                    Decl::Module(_)
                    | Decl::ImportDefault(_)
                    | Decl::ImportNamespace(_)
                    | Decl::ImportSpec(_)
                    | Decl::ImportEquals(_)
                    | Decl::ExportSpec(_)
                    | Decl::ExportStarAs(_) => (bound.symbols[index].name, false),
                    // Variables and parameters are patterns. The name of an interface or a type parameter has no value meaning.
                    _ => continue,
                };
                // A method is written with the other members.
                if let Decl::Fn(f) = decl
                    && !matches!(
                        bound.fns[f.idx()].owner,
                        FnOwner::Stmt(_) | FnOwner::Expr(_)
                    )
                {
                    continue;
                }
                if name == Atom::NONE {
                    continue;
                }
                let Some(start) = self.declaration_name_start(file, decl) else {
                    continue;
                };
                let ty = if is_type_declaration {
                    self.declared_type(sym)
                } else {
                    self.type_of_symbol(sym)
                };
                let mut type_text = self.type_to_string_for_baseline(ty);
                // "T : T" says nothing about `type T = ..`: it is written without its own name.
                if matches!(decl, Decl::Alias(_)) && type_text == *self.atom_text(name) {
                    type_text = self.type_to_string_for_baseline_in_type_alias(ty);
                }
                // `import { a as b }`, `export { a as b }`: `a` is written too (`IsDeclarationNameOrImportPropertyName`).
                let other_name = match decl {
                    Decl::ImportSpec(spec) if hir[spec].imported_pos != hir[spec].pos => {
                        Some(hir[spec].imported_pos)
                    }
                    Decl::ExportSpec(spec) if hir[spec].local_pos != hir[spec].pos => {
                        Some(hir[spec].local_pos)
                    }
                    _ => None,
                };
                for start in [Some(start), other_name].into_iter().flatten() {
                    results.push(TypeAtLocation {
                        start,
                        end: end_of_name(&hir.text, start),
                        type_text: type_text.clone(),
                        kind: "declaration-name",
                    });
                }
            }
        }
    }

    /// The names of the members of classes, interfaces and type literals.
    fn types_at_member_names(&mut self, file: FileId, results: &mut Vec<TypeAtLocation>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for index in 0..hir.members.len() {
            let m = MemberId(index as u32);
            let member = hir[m];
            if !matches!(
                member.kind,
                MemberKind::Property | MemberKind::Method | MemberKind::Getter | MemberKind::Setter
            ) {
                continue;
            }
            let Some(name) = self.member_name(file, member.key) else {
                continue;
            };
            let container = match bound.member_owner[index] {
                MemberOwner::Class(c) => {
                    let class = self.files().sym(file, bound.class_symbol[c.idx()]);
                    if member.flags.contains(Flags::STATIC) {
                        self.type_of_symbol(class)
                    } else {
                        self.declared_type(class)
                    }
                }
                MemberOwner::Interface(i) => {
                    let interface = self.files().sym(file, bound.interface_symbol[i.idx()]);
                    self.declared_type(interface)
                }
                MemberOwner::TypeLiteral(node) => self.type_from_node(file, node),
                MemberOwner::None => continue,
            };
            let Some((prop, mapper)) = self.prop_of(container, name) else {
                continue;
            };
            let ty = self.type_of_prop(&prop, mapper);
            let start = super::errors_x_properties_jsx::start_of_member_name(hir, m);
            results.push(TypeAtLocation {
                start,
                end: end_of_name(&hir.text, start),
                type_text: self.type_to_string_for_baseline(ty),
                kind: "member-name",
            });
        }
    }

    /// The names of the properties of object literals and of JSX attributes.
    fn types_at_property_names(&mut self, file: FileId, results: &mut Vec<TypeAtLocation>) {
        let hir = self.hir(file);
        for index in 0..hir.props.len() {
            let p = PropId(index as u32);
            let prop = hir[p];
            if matches!(prop.kind, PropKind::Spread) || matches!(prop.key, PropKey::None) {
                continue;
            }
            // `getWidenedTypeForVariableLikeDeclaration`
            let ty = self.type_of_literal_prop(file, p);
            let ty = self.widened(ty);
            results.push(TypeAtLocation {
                start: prop.pos,
                end: end_of_name(&hir.text, prop.pos),
                type_text: self.type_to_string_for_baseline(ty),
                kind: "property-name",
            });
        }
    }
}

/// The end of the property name, identifier or string that starts at `start`.
fn end_of_name(text: &[u8], start: u32) -> u32 {
    let mut at = start as usize;
    match text.get(at) {
        Some(&quote @ (b'"' | b'\'')) => {
            at += 1;
            while at < text.len() && text[at] != quote {
                at += if text[at] == b'\\' { 2 } else { 1 };
            }
            at + 1
        }
        Some(b'[') => {
            let mut depth = 0usize;
            while at < text.len() {
                match text[at] {
                    b'[' | b'(' | b'{' => depth += 1,
                    b']' | b')' | b'}' => {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    _ => {}
                }
                at += 1;
            }
            at + 1
        }
        _ => {
            while at < text.len()
                && (text[at].is_ascii_alphanumeric()
                    || matches!(text[at], b'_' | b'$' | b'#' | b'.' if text[at] != b'.' || text[start as usize].is_ascii_digit())
                    || text[at] >= 0x80)
            {
                at += 1;
            }
            at
        }
    }
    .min(text.len()) as u32
}
