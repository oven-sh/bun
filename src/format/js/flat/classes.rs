//! Classes and their members.

use super::*;

impl<'a> Line<'_, 'a> {
    /// A class declaration without decorators, which the modifiers have been written of.
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
            return Err(Refused);
        }
        if !self.is_quiet {
            let owned = self.f.comments().of_node(AstNodes::ClassBody(class));
            if owned.is_ignored || !owned.leading.is_empty() || !owned.dangling.is_empty() {
                return Err(Refused);
            }
        }
        self.end_line_with(Part::ClassBody(class), class.body_span(), 2)
    }

    /// The modifiers of a member of a class, in the order in which they're printed.
    pub(super) fn member_modifiers(&mut self, member: Member<'a>, is_method: bool) -> Written {
        let modifiers = member.modifiers();
        if modifiers.is_empty() {
            return Ok(());
        }
        let mut present = Flags::empty();
        for modifier in modifiers {
            if modifier.decorator().is_some() {
                return Err(Refused);
            }
            present |= modifier.flag();
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

    /// A property or a method of a class. Without the `;` of a property.
    pub(super) fn class_member(&mut self, member: Member<'a>) -> Written {
        match member.as_ast_nodes() {
            AstNodes::PropertyDefinition(_) => {
                self.member_modifiers(member, false)?;
                self.member_key(member.key())?;
                let flags = member.flags();
                if flags.contains(Flags::OPTIONAL) {
                    self.byte(b'?')?;
                }
                if flags.contains(Flags::DEFINITE) {
                    self.byte(b'!')?;
                }
                self.type_annotation(member.ty())?;
                match member.init() {
                    Some(init) => {
                        self.token(" = ")?;
                        self.last_assigned(init)
                    }
                    None => Ok(()),
                }
            }
            AstNodes::MethodDefinition(_) => {
                let func = member.func().ok_or(Refused)?;
                if !func.has_body() {
                    return Err(Refused);
                }
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
                    Some(keyword) if self.text_of(keyword.span()) == b"constructor" => {
                        self.token("constructor")?
                    }
                    Some(_) => return Err(Refused),
                    None => self.member_key(member.key())?,
                }
                if member.flags().contains(Flags::OPTIONAL) {
                    self.byte(b'?')?;
                }
                self.signature(func)?;
                self.body(func, true)
            }
            _ => Err(Refused),
        }
    }

    /// The name of a member of a class: a plain or a private name.
    pub(super) fn member_key(&mut self, key: Option<Key<'a>>) -> Written {
        let key = key.ok_or(Refused)?;
        if !matches!(key.kind(), KeyKind::Ident(_) | KeyKind::Private(_))
            || self.f.options().quote_properties.is_consistent()
        {
            return Err(Refused);
        }
        let span = key.span(self.f.file());
        self.source(span)
    }
}
