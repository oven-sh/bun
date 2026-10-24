use super::{Chain, Expr, ExprId, ExprKind, FileBuilder, FileIn, Storage};
use crate::atom::Atom;

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct ExprFlags: u8 {
        const PARENTHESIZED = 1 << 0;
        const BRACKET_ACCESS = 1 << 1;
        const OPTIONAL_CHAIN_LINK = 1 << 2;
        const PRIVATE_NAME = 1 << 3;
        const TEMPLATE_LITERAL = 1 << 4;
        const RESOLVED_AT_RUNTIME = 1 << 5;
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct TemplatePart {
    pub cooked: Option<Atom>,
    pub raw: Atom,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum MemberKey {
    Name(Atom),
    PrivateName(Atom),
    Computed(ExprId),
}

#[inline]
pub fn kind_flags(kind: &ExprKind) -> ExprFlags {
    match *kind {
        ExprKind::Dot { chain, .. } => chain_flags(chain),
        ExprKind::Index { chain, .. } => ExprFlags::BRACKET_ACCESS | chain_flags(chain),
        ExprKind::PrivateIdentifier(_) => ExprFlags::PRIVATE_NAME,
        _ => ExprFlags::empty(),
    }
}

#[inline]
pub(super) fn chain_flags(chain: Chain) -> ExprFlags {
    match chain {
        Chain::Start => ExprFlags::OPTIONAL_CHAIN_LINK,
        Chain::No | Chain::Continue => ExprFlags::empty(),
    }
}

impl<S: Storage> FileIn<S> {
    #[inline]
    pub fn expr_flags(&self, e: ExprId) -> ExprFlags {
        self.expr_flags.get(e.idx()).copied().unwrap_or_default()
    }

    pub fn template_parts(&self, template: ExprId) -> &[TemplatePart] {
        let starts = &self.template_part_starts;
        let Ok(at) = starts.binary_search_by_key(&template, |start| start.0) else {
            return &[];
        };
        let first = starts[at].1 as usize;
        let len = self.template_part_count(template);
        self.template_parts.get(first..first + len).unwrap_or(&[])
    }

    pub(super) fn template_part_count(&self, template: ExprId) -> usize {
        match self.exprs.get(template.idx()).map(|expr| expr.kind) {
            Some(ExprKind::Template { exprs }) => exprs.len() + 1,
            _ => 1,
        }
    }

    pub fn member_key(&self, e: ExprId) -> Option<(ExprId, MemberKey)> {
        match self.exprs.get(e.idx())?.kind {
            ExprKind::Dot { obj, name, .. }
                if self.expr_flags(e).contains(ExprFlags::PRIVATE_NAME) =>
            {
                Some((obj, MemberKey::PrivateName(name)))
            }
            ExprKind::Dot { obj, name, .. } => Some((obj, MemberKey::Name(name))),
            ExprKind::Index { obj, index, .. } => Some((obj, self.index_member_key(index))),
            _ => None,
        }
    }

    fn index_member_key(&self, index: ExprId) -> MemberKey {
        match self.exprs.get(index.idx()).map(|expr| expr.kind) {
            Some(ExprKind::String(text)) => MemberKey::Name(text),
            Some(ExprKind::Template { exprs }) if exprs.is_empty() => {
                MemberKey::Name(self.id_at(self.template_texts(exprs), 0))
            }
            _ => MemberKey::Computed(index),
        }
    }

    pub fn jsx_attribute_text(&self, value: ExprId) -> Atom {
        let texts = &self.jsx_attribute_texts;
        if let Ok(at) = texts.binary_search_by_key(&value, |text| text.0) {
            return texts[at].1;
        }
        match self.exprs.get(value.idx()).map(|expr| expr.kind) {
            Some(ExprKind::String(text)) => text,
            _ => {
                debug_assert!(false, "the value of a JSX attribute is a string");
                Atom::NONE
            }
        }
    }

    #[inline]
    pub fn type_assertion_operand(&self, e: ExprId) -> Option<ExprId> {
        match self.exprs.get(e.idx())?.kind {
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => Some(expr),
            _ => None,
        }
    }

    #[inline]
    pub fn skip_type_assertions(&self, mut e: ExprId) -> ExprId {
        while let Some(operand) = self.type_assertion_operand(e) {
            e = operand;
        }
        e
    }
}

impl FileBuilder {
    #[inline]
    pub fn add_flags(&mut self, e: ExprId, flags: ExprFlags) {
        self.expr_flags[e.idx()] |= flags;
    }

    #[inline]
    pub fn pop_expr(&mut self) -> Option<Expr> {
        self.expr_flags.pop();
        self.exprs.pop()
    }
}
