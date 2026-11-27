use super::expression::Owner;
use super::*;

const GETTER: u8 = 1;
const SETTER: u8 = 2;
const STATIC: u8 = 4;

impl Parser<'_> {
    /// At the `class`.
    pub(super) fn class(&mut self, start: u32, flags: u32) -> P {
        self.enter()?;
        self.next();
        let name = match self.token() {
            T::OpenBrace | T::Extends | T::Implements | T::Lt => NONE,
            _ => self.type_name()?,
        };
        let type_params = self.optional_type_parameters(flag::CONST | flag::IN | flag::OUT)?;
        let mut extends = NONE;
        if self.eat(T::Extends) {
            let start = self.start();
            let (e, type_args) = self.superclass()?;
            extends = self.add2(K::Extends, start, e, type_args);
        }
        let base = self.list_base();
        if self.token() == T::Implements {
            self.require_typescript()?;
            self.heritage()?;
        }
        let body = self.class_body(flags, extends != NONE)?;
        self.leave();
        let id = self.add(
            K::Class,
            T::Unknown,
            flags,
            start,
            [name, type_params, extends, body],
        );
        self.take_list(id, base)
    }

    /// With its type arguments.
    fn superclass(&mut self) -> P<(Id, Id)> {
        let start = self.start();
        require(self.token().is_identifier())?;
        let (mut e, mut calls, mut count) = (self.leaf(K::Ident), 0, 0);
        loop {
            self.add_link(&mut count)?;
            let type_args = match self.token() {
                T::Lt => self.type_arguments_in_expression()?,
                _ => NONE,
            };
            e = match self.token() {
                T::OpenBrace | T::Implements => return Some((e, type_args)),
                T::OpenParen if !self.has(ctx::AMBIENT) => {
                    self.call(start, e, type_args, 0, &mut calls)?
                }
                T::Dot if type_args == NONE => self.member(start, e)?,
                _ => return None,
            };
        }
    }

    fn member(&mut self, start: u32, object: Id) -> P {
        self.pass(Gap::None, Gap::None);
        require(!self.newline_before())?;
        let name = self.word()?;
        Some(self.add2(K::Dot, start, object, name))
    }

    #[inline]
    pub(super) fn optional_decorators(&mut self) -> P {
        match self.token() {
            T::At => self.decorators(),
            _ => Some(NONE),
        }
    }

    pub(super) fn decorators(&mut self) -> P {
        require(!self.has(ctx::AMBIENT))?;
        let (start, base) = (self.start(), self.list_base());
        while self.token() == T::At {
            let e = self.with(
                self.ctx & ctx::FOR_INIT | ctx::NO_ARGUMENTS,
                Self::decorator,
            )?;
            self.push(e);
        }
        self.odd();
        self.add_list(K::Decorators, 0, start, base)
    }

    /// `@a`, `@a.b`, `@a.b()`
    fn decorator(&mut self) -> P {
        self.pass_prefix();
        let (start, first_node) = (self.start(), self.tree.nodes.len());
        require(self.token() == T::Ident && start == self.lx.at.prev_end)?;
        let (mut e, mut count) = (self.leaf(K::Ident), 0);
        while self.token() == T::Dot {
            e = self.member(start, e)?;
            self.add_link(&mut count)?;
        }
        let type_args = match self.token() {
            T::Lt => self.type_arguments_in_expression()?,
            _ => NONE,
        };
        require(type_args == NONE || self.token() == T::OpenParen)?;
        if self.token() == T::OpenParen {
            let may_have_templates = self.text(e) == b"Component";
            e = self.call(start, e, type_args, 0, &mut 0)?;
            if may_have_templates {
                let nodes = self.tree.nodes.get(first_node..)?;
                self.unsure_if(nodes.iter().any(|it| it.kind == K::Template));
            }
        }
        let next = self.token();
        require(
            next.is_word()
                || matches!(
                    next,
                    T::At | T::Str | T::PrivateName | T::OpenBrace | T::Star
                ),
        )?;
        Some(e)
    }

    fn class_body(&mut self, class_flags: u32, is_derived: bool) -> P {
        let (start, base) = (self.start(), self.list_base());
        let first_name = self.buffers.private_names.len();
        let first_use = self.buffers.private_uses.len();
        self.expect(T::OpenBrace)?;
        self.class_depth += 1;
        let mut has_constructor = false;
        let members = self.in_brackets(|p| {
            while !p.eat(T::CloseBrace) {
                let member = p.class_member(class_flags, is_derived, first_name)?;
                let node = p.node(member);
                if node.op == T::Constructor && p.node(node.b).d != NONE {
                    require(!std::mem::replace(&mut has_constructor, true))?;
                }
                p.push(member);
            }
            Some(())
        });
        self.class_depth -= 1;
        let mut uses = std::mem::take(&mut self.buffers.private_uses);
        let declared = self.buffers.private_names.get(first_name..)?;
        let mut kept = first_use;
        for i in first_use..uses.len() {
            let name = *uses.get(i)?;
            if !declared
                .iter()
                .any(|it| self.slice(it.0) == self.slice(name))
            {
                *uses.get_mut(kept)? = name;
                kept += 1;
            }
        }
        uses.truncate(kept);
        self.buffers.private_uses = uses;
        self.buffers.private_names.truncate(first_name);
        members?;
        require(self.class_depth > 0 || kept == 0)?;
        self.add_list(K::ClassBody, 0, start, base)
    }

    pub(super) fn modifiers(&mut self) -> P<u32> {
        let mut flags = 0;
        loop {
            let modifier = match self.token() {
                T::Declare => flag::DECLARE,
                T::Public => flag::PUBLIC,
                T::Protected => flag::PROTECTED,
                T::Private => flag::PRIVATE,
                T::Static => flag::STATIC,
                T::Abstract => flag::ABSTRACT,
                T::Override => flag::OVERRIDE,
                T::Readonly => flag::READONLY,
                T::Accessor | T::Export | T::Default | T::Const | T::In
                    if self.is_followed_by_key()? =>
                {
                    return None;
                }
                _ => return Some(flags),
            };
            if !self.is_followed_by_key()? {
                return Some(flags);
            }
            let is_second_accessibility =
                modifier & flag::ACCESSIBILITY != 0 && flags & flag::ACCESSIBILITY != 0;
            require(modifier > flags && !is_second_accessibility)?;
            require(modifier == flag::STATIC || self.language.is_typescript)?;
            flags |= modifier;
            self.pass_keyword();
        }
    }

    fn class_member(&mut self, class_flags: u32, is_derived: bool, first_name: usize) -> P {
        let start = self.start();
        let kept = self.ctx & (ctx::FOR_INIT | ctx::AMBIENT);
        let is_ambient = self.has(ctx::AMBIENT);
        if self.token() == T::Static && self.peek().0 == T::OpenBrace {
            require(!is_ambient)?;
            self.next();
            let ctx = kept | ctx::SUPER_MEMBER | ctx::NEW_TARGET | ctx::NO_ARGUMENTS;
            let block = self.with(ctx, |p| p.block_without_labels(K::Block))?;
            return Some(self.add1(K::StaticBlock, start, block));
        }
        let decorators = self.optional_decorators()?;
        let mut flags = self.modifiers()?;
        require(decorators == NONE || flags & (flag::ABSTRACT | flag::DECLARE) == 0)?;
        let has = |flags: u32, all: u32| flags & all == all;
        require(flags & flag::OVERRIDE == 0 || is_derived)?;
        require(flags & flag::DECLARE == 0 || (flags & flag::OVERRIDE == 0 && !is_ambient))?;
        if flags & flag::ABSTRACT != 0 {
            require(class_flags & flag::ABSTRACT != 0)?;
            require(flags & (flag::PRIVATE | flag::STATIC | flag::DECLARE) == 0)?;
        }
        if self.token() == T::OpenBracket && self.is_index_signature() {
            require(flags & !(flag::STATIC | flag::READONLY) == 0 && decorators == NONE)?;
            let id = self.index_signature(start, flags)?;
            self.semicolon()?;
            return Some(self.extend(id));
        }
        let (mut op, fn_flags) = self.method_prefix()?;
        let token = self.token();
        let (key, key_flags) = match token {
            T::PrivateName => (self.leaf(K::PrivateName), 0),
            _ => self.property_key()?,
        };
        flags |= key_flags;
        let text = self.text(key);
        match token {
            T::PrivateName => {
                let not_allowed = flag::ACCESSIBILITY | flag::ABSTRACT | flag::DECLARE;
                require(flags & (not_allowed | flag::OVERRIDE) == 0 && !is_ambient)?;
                require(text != b"#constructor")?;
                self.declare_private_name(key, op, flags, first_name)?;
            }
            T::Str => require(!matches!(text.get(1..4), Some(b"con" | b"pro")))?,
            T::Ident => require(!(has(flags, flag::STATIC) && text == b"prototype"))?,
            _ => {}
        }
        if self.eat_suffix(T::Question) {
            self.require_typescript()?;
            require(!matches!(op, T::Get | T::Set) && token != T::Constructor)?;
            flags |= flag::OPTIONAL;
        }
        if op == T::Unknown && !matches!(self.token(), T::OpenParen | T::Lt) {
            require(token != T::Constructor)?;
            return self.field(start, key, flags, decorators);
        }
        require(flags & (flag::READONLY | flag::DECLARE) == 0)?;
        let (mut ctx, mut owner) = (ctx::SUPER_MEMBER, Owner::Method);
        if token == T::Constructor {
            require(op == T::Unknown && flags & !flag::ACCESSIBILITY == 0 && decorators == NONE)?;
            (op, owner) = (T::Constructor, Owner::Constructor);
            if is_derived {
                ctx |= ctx::SUPER_CALL;
            }
        } else if op == T::Unknown {
            op = T::OpenParen;
        }
        let value = self.method_value(op, fn_flags, ctx, owner)?;
        let function = *self.node(value);
        require(op != T::Constructor || (function.b == NONE && function.c == NONE))?;
        let has_decorators = |&it: &Id| self.node(it).d != NONE;
        if self.tree.list(function.params()).iter().any(has_decorators) {
            require(function.d != NONE && class_flags & flag::DECLARATION != 0)?;
        }
        if function.d == NONE {
            require(decorators == NONE)?;
            let is_accessor = matches!(op, T::Get | T::Set);
            require(fn_flags == 0 && token != T::PrivateName)?;
            require(!is_accessor || is_ambient || has(flags, flag::ABSTRACT))?;
            self.semicolon()?;
        } else {
            require(!has(flags, flag::ABSTRACT))?;
        }
        Some(self.add(K::Method, op, flags, start, [key, value, NONE, decorators]))
    }

    /// Makes `id` end with the previous token, a semicolon on the same line.
    fn extend(&mut self, id: Id) -> Id {
        let end = self.lx.at.prev_end;
        let is_adjacent = end <= self.node(id).end + 1;
        self.unsure_if(!is_adjacent);
        if let Some(node) = self.tree.nodes.get_mut(id as usize) {
            node.end = end;
        }
        id
    }

    fn declare_private_name(&mut self, key: Id, op: T, flags: u32, first_name: usize) -> P<()> {
        let kind = match op {
            T::Get => GETTER,
            T::Set => SETTER,
            _ => GETTER | SETTER,
        } | if flags & flag::STATIC != 0 { STATIC } else { 0 };
        let declared = self.buffers.private_names.get(first_name..)?;
        let clashes = |&(name, other): &(Name, u8)| {
            self.slice(name) == self.text(key) && kind ^ other != GETTER | SETTER
        };
        require(declared.len() < 200 && !declared.iter().any(clashes))?;
        let name = (self.node(key).start, self.node(key).end);
        self.buffers.private_names.push((name, kind));
        Some(())
    }

    fn field(&mut self, start: u32, key: Id, mut flags: u32, decorators: Id) -> P {
        let has_no_value = flags & (flag::ABSTRACT | flag::DECLARE) != 0 || self.has(ctx::AMBIENT);
        if self.token() == T::Bang && !self.newline_before() {
            require(flags & (flag::OPTIONAL | flag::STATIC) == 0 && !has_no_value)?;
            self.pass(Gap::None, Gap::Open);
            require(self.token() == T::Colon)?;
            flags |= flag::DEFINITE;
        }
        let ty = self.optional_type_annotation()?;
        let mut value = NONE;
        if self.eat_infix(T::Eq) {
            require(flags & flag::DEFINITE == 0 && !has_no_value)?;
            let ctx = ctx::SUPER_MEMBER | ctx::NEW_TARGET | ctx::NO_ARGUMENTS;
            value = self.with(ctx | self.ctx & ctx::FOR_INIT, Self::assignment)?;
        }
        self.semicolon()?;
        self.odd_if(!self.style.has_semicolons);
        Some(self.add(
            K::Field,
            T::Unknown,
            flags,
            start,
            [key, ty, value, decorators],
        ))
    }
}
