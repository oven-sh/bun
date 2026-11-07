//! Classes and their members.

use super::*;
use crate::js::utils::object::printed_key;

impl<'a> Line<'_, 'a> {
    /// A class declaration, which the decorators and the modifiers have been written of.
    pub(super) fn class(&mut self, class: Class<'a>) -> Written {
        self.token("class")?;
        if let Some(name) = class.name() {
            self.byte(b' ')?;
            self.source(name.span())?;
        }
        self.type_parameters(class.type_params())?;
        if let Some(extends) = class.extends() {
            self.token(" extends ")?;
            self.expr(extends, Place::Other)?;
            self.type_arguments(class.extends_args())?;
        }
        if !class.implements().is_empty() {
            self.token(" implements ")?;
            self.list(class.implements().iter(), |line, ty| line.ty(ty))?;
        }
        if class.members().is_empty() {
            return self.token(" {}");
        }
        if !self.is_quiet {
            let owned = self.f.comments().of_node(AstNodes::ClassBody(class));
            if owned.is_ignored || !owned.leading.is_empty() || !owned.dangling.is_empty() {
                return Err(Refused);
            }
        }
        self.end_line_with(Part::ClassBody(class), class.body_span(), 2)
    }

    /// The decorators and the modifiers of a member of a class, in the order in which they're printed.
    pub(super) fn member_modifiers(&mut self, member: Member<'a>, is_method: bool) -> Written {
        let modifiers = member.modifiers();
        if modifiers.is_empty() {
            return Ok(());
        }
        let mut present = Flags::empty();
        let mut has_decorators = false;
        for modifier in modifiers {
            has_decorators |= modifier.decorator().is_some();
            present |= modifier.flag();
        }
        if has_decorators {
            present = Flags::empty();
            // Each is on a line if one of them is in the source.
            // Else they're on the line of the member, if what's on it up to where it can break first fits.
            let are_on_own_lines = member.decorators().any(|it| self.ends_its_line(it));
            let breaks = std::mem::replace(&mut self.breaks, false);
            for modifier in modifiers {
                let Some(decorator) = modifier.decorator() else {
                    present |= modifier.flag();
                    continue;
                };
                self.decorator(decorator, are_on_own_lines)?;
                match are_on_own_lines {
                    true => self.break_line(0)?,
                    false => self.byte(b' ')?,
                }
            }
            self.breaks = breaks;
        }
        let known = Flags::PUBLIC
            | Flags::PROTECTED
            | Flags::PRIVATE
            | Flags::STATIC
            | Flags::ABSTRACT
            | Flags::OVERRIDE
            | Flags::ASYNC
            | if is_method {
                Flags::empty()
            } else {
                Flags::AMBIENT | Flags::READONLY
            };
        if !known.contains(present) {
            return Err(Refused);
        }
        for (flag, keyword) in [
            (Flags::AMBIENT, "declare "),
            (Flags::PUBLIC, "public "),
            (Flags::PROTECTED, "protected "),
            (Flags::PRIVATE, "private "),
            (Flags::STATIC, "static "),
            (Flags::ABSTRACT, "abstract "),
            (Flags::OVERRIDE, "override "),
            (Flags::READONLY, "readonly "),
        ] {
            if present.contains(flag) {
                self.token(keyword)?;
            }
        }
        Ok(())
    }

    /// A member of a class. Without the `;` of a property.
    pub(super) fn class_member(&mut self, member: Member<'a>) -> Written {
        let node = member.as_ast_nodes();
        // A `;` on a line of its own is part of nothing, so a block comment after it is printed on the member's line.
        let comments = self.f.comments();
        if comments.is_owner(Node::Member(member))
            && (comments.of_node(node).trailing.iter()).any(|comment| !comment.is_line())
        {
            return Err(Refused);
        }
        match node {
            AstNodes::PropertyDefinition(_) => {
                self.member_modifiers(member, false)?;
                self.member_key(member.key(), node)?;
                let flags = member.flags();
                if flags.contains(Flags::OPTIONAL) {
                    self.byte(b'?')?;
                }
                if flags.contains(Flags::DEFINITE) {
                    self.byte(b'!')?;
                }
                match (member.ty(), member.init()) {
                    (Some(ty), None) => self.last_type_after(":", ty),
                    (ty, Some(init)) => {
                        self.type_annotation(ty)?;
                        self.token(" = ")?;
                        self.last_assigned(init)
                    }
                    (None, None) => Ok(()),
                }
            }
            AstNodes::MethodDefinition(_) => {
                let func = member.func().ok_or(Refused)?;
                self.member_modifiers(member, true)?;
                match member.kind() {
                    MemberKind::Getter => self.token("get ")?,
                    MemberKind::Setter => self.token("set ")?,
                    _ => {}
                }
                if func.is_async() {
                    self.token("async ")?;
                }
                if func.is_generator() {
                    self.byte(b'*')?;
                }
                match member.constructor_keyword() {
                    Some(keyword)
                        if self.text_of(keyword.span()) == b"constructor"
                            && !self.f.options().quote_properties.is_consistent()
                            && !member.flags().contains(Flags::OVERRIDE) =>
                    {
                        self.token("constructor")?
                    }
                    Some(_) => return Err(Refused),
                    None => self.member_key(member.key(), node)?,
                }
                if member.flags().contains(Flags::OPTIONAL) {
                    self.byte(b'?')?;
                }
                self.head(func, true)?;
                match func.has_body() {
                    true => self.body(func, true),
                    false => self.semicolon(),
                }
            }
            AstNodes::TSIndexSignature(_) => {
                let mut present = Flags::empty();
                for modifier in member.modifiers() {
                    present |= modifier.flag();
                }
                if !(Flags::STATIC | Flags::READONLY).contains(present) {
                    return Err(Refused);
                }
                if present.contains(Flags::STATIC) {
                    self.token("static ")?;
                }
                if present.contains(Flags::READONLY) {
                    self.token("readonly ")?;
                }
                self.index_signature(member)?;
                self.semicolon()
            }
            _ => Err(Refused),
        }
    }

    /// The name of `parent`, a member of a class, an interface, a type literal or an enum.
    pub(super) fn member_key(&mut self, key: Option<Key<'a>>, parent: AstNodes<'a>) -> Written {
        let key = key.ok_or(Refused)?;
        match key.kind() {
            KeyKind::Ident(_) | KeyKind::Private(_)
                if !self.f.options().quote_properties.is_consistent() =>
            {
                let span = key.span(self.f.file());
                self.source(span)
            }
            KeyKind::Computed(e) => {
                self.byte(b'[')?;
                self.expr(e, Place::Other)?;
                self.byte(b']')
            }
            _ => {
                let printed = printed_key(key, key.inner_span(self.f.file()), parent, self.f);
                // A template can have a line break in it, and a name is printed without escapes.
                if !printed.iter().all(|byte| *byte >= b' ')
                    || (matches!(key.kind(), KeyKind::Ident(_) | KeyKind::Private(_))
                        && bun_core::strings::contains_char(&printed, b'\\'))
                {
                    return Err(Refused);
                }
                if !key.is_computed() {
                    return self.long_bytes(&printed);
                }
                self.byte(b'[')?;
                self.long_bytes(&printed)?;
                self.byte(b']')
            }
        }
    }
}
