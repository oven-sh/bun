//! Interfaces, enums and namespaces, and the members of interfaces, type literals and enums.

use super::holes::Hole;
use super::*;

/// Writes `member` of an interface, or of a type literal whose members are each on a line. The caller writes the `;`.
pub(crate) fn write_signature<'a>(member: Member<'a>, f: &mut Formatter<'a>) -> bool {
    let least = u32::from(f.options().semicolons.is_always());
    f.write_line(member.span(), (least, 1), &|line| {
        line.only_in_typescript()?;
        line.type_member(member, true)
    })
}

/// Writes `member` of an enum. The caller writes the comma.
pub(crate) fn write_enum_member<'a>(member: EnumMember<'a>, f: &mut Formatter<'a>) -> bool {
    let has_comma = !f.options().trailing_commas.is_none()
        || !matches!(member.parent(), Node::Stmt(statement) if matches!(
            statement.kind(),
            StmtKind::Enum(declaration) if declaration.members().last() == Some(member)
        ));
    let after = u32::from(has_comma);
    f.write_line(member.span(), (after, after), &|line| {
        line.only_in_typescript()?;
        line.enum_member(member)
    })
}

impl<'a> Line<'_, 'a> {
    /// True if `node`, the braces of a declaration, has comments of its own.
    fn body_has_comments(&self, node: AstNodes<'a>) -> bool {
        if self.is_quiet {
            return false;
        }
        let owned = self.f.comments().of_node(node);
        owned.is_ignored || !owned.leading.is_empty() || !owned.dangling.is_empty()
    }

    /// An interface, which the modifiers have been written of.
    pub(super) fn interface(&mut self, statement: Stmt<'a>, interface: Interface<'a>) -> Written {
        self.token("interface ")?;
        self.source(interface.name().span())?;
        self.type_parameters(interface.type_params())?;
        if !interface.extends().is_empty() {
            self.token(" extends ")?;
            self.list(interface.extends().iter(), |line, ty| line.ty(ty))?;
        }
        if interface.members().is_empty() {
            return self.token(" {}");
        }
        if self.body_has_comments(AstNodes::TSInterfaceBody(statement)) {
            return Err(Refused);
        }
        self.end_line_with_hole(Hole::BodyOf(statement), interface.body_span(), 2)
    }

    /// An enum, which the modifiers have been written of.
    pub(super) fn enum_declaration(
        &mut self,
        statement: Stmt<'a>,
        declaration: Enum<'a>,
    ) -> Written {
        self.token("enum ")?;
        self.source(declaration.name().span())?;
        if declaration.members().is_empty() {
            return self.token(" {}");
        }
        if self.body_has_comments(AstNodes::TSEnumBody(statement)) {
            return Err(Refused);
        }
        self.end_line_with_hole(Hole::BodyOf(statement), declaration.body_span(), 2)
    }

    /// `namespace A.B { .. }`, `module "a" { .. }`, `global { .. }`, which the modifiers have been written of.
    pub(super) fn module(&mut self, statement: Stmt<'a>, module: Module<'a>) -> Written {
        match module.name() {
            ModuleName::Global => self.token("global")?,
            ModuleName::String(name) => {
                self.token("module ")?;
                self.string(name.span())?;
            }
            ModuleName::Ident(name) => {
                self.token(match module.uses_module_keyword() {
                    true => "module ",
                    false => "namespace ",
                })?;
                self.source(name.span())?;
            }
        }
        let mut innermost = module;
        while let Some(nested) = innermost.nested() {
            let ModuleName::Ident(name) = nested.name() else {
                return Err(Refused);
            };
            self.byte(b'.')?;
            self.source(name.span())?;
            innermost = nested;
        }
        let Some(span) = innermost.body_span() else {
            return self.semicolon();
        };
        if is_empty_block(innermost.body()) {
            return self.token(" {}");
        }
        if self.body_has_comments(AstNodes::TSModuleBlock(statement)) {
            return Err(Refused);
        }
        self.end_line_with_hole(Hole::BodyOf(statement), span, 2)
    }

    /// `A`, `A = 1`
    fn enum_member(&mut self, member: EnumMember<'a>) -> Written {
        // Nothing but the initializer can break.
        if self.breaks {
            return Err(Refused);
        }
        let key = member.key().ok_or(Refused)?;
        if key.is_computed() {
            return Err(Refused);
        }
        self.member_key(Some(key), AstNodes::TSEnumMember(member))?;
        match member.init() {
            Some(init) => {
                self.token(" = ")?;
                self.expr(init, Place::Other)
            }
            None => Ok(()),
        }
    }

    /// A member of an interface or a type literal, without what separates it from the next one. Unless it `is_last` on
    /// its line, it's written on one line.
    pub(super) fn type_member(&mut self, member: Member<'a>, is_last: bool) -> Written {
        let node = member.as_ast_nodes();
        let mut is_readonly = false;
        for modifier in member.modifiers() {
            let flag = modifier.flag();
            let is_printed = match node {
                AstNodes::TSPropertySignature(_) | AstNodes::TSIndexSignature(_) => {
                    flag == Flags::READONLY
                }
                _ => false,
            };
            if !is_printed || is_readonly {
                return Err(Refused);
            }
            is_readonly = true;
        }
        if is_readonly {
            self.token("readonly ")?;
        }
        let is_optional = member.flags().contains(Flags::OPTIONAL);
        match node {
            AstNodes::TSPropertySignature(_) => {
                self.member_key(member.key(), node)?;
                if is_optional {
                    self.byte(b'?')?;
                }
                match member.ty() {
                    Some(ty) if is_last => self.last_type_after(":", ty),
                    ty => self.type_annotation(ty),
                }
            }
            AstNodes::TSMethodSignature(_) => {
                match member.kind() {
                    MemberKind::Getter => self.token("get ")?,
                    MemberKind::Setter => self.token("set ")?,
                    _ => {}
                }
                self.member_key(member.key(), node)?;
                if is_optional {
                    self.byte(b'?')?;
                }
                self.head_of_signature(member, is_last)
            }
            AstNodes::TSCallSignatureDeclaration(_) => self.head_of_signature(member, is_last),
            AstNodes::TSConstructSignatureDeclaration(_) => {
                self.token("new ")?;
                self.head_of_signature(member, is_last)
            }
            AstNodes::TSIndexSignature(_) => self.index_signature(member),
            _ => Err(Refused),
        }
    }

    fn head_of_signature(&mut self, member: Member<'a>, is_last: bool) -> Written {
        self.head(member.func().ok_or(Refused)?, is_last)
    }

    /// `[key: string]: T`, which the modifiers have been written of.
    pub(super) fn index_signature(&mut self, member: Member<'a>) -> Written {
        let signature = member.func().ok_or(Refused)?;
        self.byte(b'[')?;
        self.list(signature.params().iter(), |line, param| {
            if !param.modifiers().is_empty() {
                return Err(Refused);
            }
            line.parameter(param)
        })?;
        self.byte(b']')?;
        self.type_annotation(signature.return_type())
    }
}
