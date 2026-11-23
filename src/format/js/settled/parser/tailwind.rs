//! Checks that the lists of Tailwind classes are sorted. See `utils/tailwindcss.rs`.

use super::*;
use crate::js::utils::tailwindcss::{
    TailwindContext, has_white_space, is_class_attribute, is_name_of_class_function,
    sorted_template_text,
};

impl Parser<'_> {
    pub(super) fn may_be_class_function(&self, callee: Id) -> bool {
        let Some(tailwind) = self.tailwind else {
            return false;
        };
        let mut node = self.node(callee);
        while matches!(node.kind, K::Call | K::Dot | K::Index | K::NonNull) {
            node = self.node(node.a);
        }
        node.kind == K::Ident
            && is_name_of_class_function(self.slice((node.start, node.end)), tailwind)
    }

    pub(super) fn check_classes_in_call(&mut self, call: Id) -> P<()> {
        let node = *self.node(call);
        if !self.may_be_class_function(node.a) {
            return Some(());
        }
        require(self.kind(node.a) == K::Ident && !node.has(flag::CHAIN))?;
        self.check_classes_in(node.c)
    }

    pub(super) fn check_classes_in_attribute(&mut self, attribute: Id) -> P<()> {
        let node = *self.node(attribute);
        match node.b != NONE && is_class_attribute(self.text(node.a), self.tailwind?) {
            true => self.check_classes_in(node.b),
            false => Some(()),
        }
    }

    /// `root` is the arguments of a function, or the value of an attribute, that takes classes.
    fn check_classes_in(&mut self, root: Id) -> P<()> {
        let (tailwind, start) = (self.tailwind?, self.node(root).start);
        for id in (1..=root).rev() {
            let node = self.node(id);
            if node.start < start {
                break;
            }
            let text = self.text(id);
            if !matches!(
                node.kind,
                K::Str | K::JsxStr | K::Template | K::TemplateType
            ) || !has_white_space(text)
                || !self.is_sorted_in(root, id)?
            {
                continue;
            }
            require(!node.has(flag::ESCAPE | flag::MULTILINE))?;
            let is_unchanged = match node.kind {
                K::Template => self.are_texts_unchanged(id, tailwind),
                _ => {
                    let classes = text.get(1..text.len() - 1)?;
                    classes.trim_ascii().len() == classes.len()
                        && strings::index_of_any(classes, b"&\"'").is_none()
                        && *tailwind.sorted(classes) == *classes
                }
            };
            require(is_unchanged)?;
        }
        Some(())
    }

    /// False if it isn't sorted, or a function between it and `root` has checked it.
    fn is_sorted_in(&self, root: Id, leaf: Id) -> P<bool> {
        let follows_plugin = self.tailwind?.follows_plugin;
        let is_template = self.kind(leaf) == K::Template;
        let (mut current, mut is_sorted) = (leaf, None);
        while current != root {
            current = self.node(current).parent;
            let node = self.node(current);
            match node.kind {
                K::Call if self.may_be_class_function(node.a) => return Some(false),
                K::Call if !follows_plugin && !is_template => _ = is_sorted.get_or_insert(false),
                K::Template | K::Binary if is_template => return None,
                K::Template => _ = is_sorted.get_or_insert(true),
                K::Args | K::Call | K::Dot | K::Index | K::NonNull | K::Spread | K::Unary => {}
                K::Cond | K::Logical | K::Binary | K::Array | K::Object | K::Prop => {}
                K::JsxContainer if current == root => {}
                _ => return None,
            }
        }
        Some(is_sorted.unwrap_or(true))
    }

    fn are_texts_unchanged(&self, template: Id, tailwind: &Tailwind) -> bool {
        let (parts, context) = (
            self.tree.list(template),
            TailwindContext::for_lone_template(tailwind),
        );
        parts.iter().enumerate().step_by(2).all(|(i, &part)| {
            let (quasi, is_last) = (self.node(part), i + 1 == parts.len());
            let text = self.slice((quasi.start + 1, quasi.end - if is_last { 1 } else { 2 }));
            !has_white_space(text)
                || sorted_template_text(text, (i == 0, is_last), context, tailwind)
                    .is_none_or(|it| it == text)
        })
    }
}
