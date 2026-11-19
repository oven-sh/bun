use super::*;

impl Parser<'_> {
    pub(super) fn jsx_expression(&mut self) -> P {
        self.lx.markup_depth += 1;
        let id = self.in_brackets(|p| p.jsx_element(false))?;
        self.lx.markup_depth -= 1;
        // Adjacent elements, or something that only looks like them.
        require(!matches!(self.token(), T::Lt | T::Shl | T::LtEq | T::Gt))?;
        Some(id)
    }

    /// At the `<`.
    fn jsx_element(&mut self, is_child: bool) -> P {
        self.enter()?;
        let start = self.start();
        let opening = self.jsx_opening(is_child)?;
        let (base, mut closing) = (self.list_base(), NONE);
        if !self.node(opening).has(flag::SELF_CLOSING) {
            self.jsx_children()?;
            self.next();
            self.expect(T::Slash)?;
            let name = self.node(opening).a;
            if name != NONE {
                closing = self.jsx_name(true)?;
                require(self.text(closing) == self.text(name))?;
            }
            require(self.token() == T::Gt)?;
            self.leave_jsx(is_child);
        }
        self.leave();
        self.odd();
        let id = self.add2(K::Jsx, start, opening, closing);
        self.take_list(id, base)
    }

    fn leave_jsx(&mut self, is_before_child: bool) {
        match is_before_child {
            true => self.lx.next_jsx_child(),
            false => self.pass(Gap::None, Gap::Open),
        }
    }

    fn jsx_opening(&mut self, is_child: bool) -> P {
        let (start, base) = (self.start(), self.list_base());
        self.pass_prefix();
        let (mut name, mut type_args, mut flags) = (NONE, NONE, 0);
        if self.token() != T::Gt {
            name = self.jsx_name(true)?;
            if self.token() == T::Lt {
                type_args = self.type_arguments()?;
            }
            while !matches!(self.token(), T::Gt | T::Slash) {
                let attribute = self.jsx_attribute()?;
                self.push(attribute);
            }
            self.odd_if(self.style.has_one_attribute_per_line && self.list_base() > base + 1);
            if self.eat_between(Gap::Space, T::Slash, Gap::None) {
                flags = flag::SELF_CLOSING;
                require(self.token() == T::Gt)?;
            }
        }
        self.leave_jsx(is_child || flags == 0);
        let id = self.add(
            K::JsxOpening,
            T::Unknown,
            flags,
            start,
            [name, type_args, NONE, NONE],
        );
        self.take_list(id, base)
    }

    /// `a`, `a-b`, and in a tag `a.b.c`, as one node.
    fn jsx_name(&mut self, is_tag: bool) -> P {
        let (start, first) = (self.start(), self.token());
        require(first.is_word() && !(is_tag && first == T::Const))?;
        let plain_end = self.lx.at.end;
        self.lx.rescan_jsx_name();
        let has_hyphen = self.lx.at.end != plain_end;
        if !is_tag {
            return Some(self.leaf_without_next(K::JsxName));
        }
        self.next();
        while self.token() == T::Dot {
            let dot = self.start();
            require(!has_hyphen && (first.is_identifier() || first == T::This))?;
            require(dot == self.lx.at.prev_end)?;
            self.pass(Gap::None, Gap::None);
            require(self.token().is_word() && self.start() == dot + 1)?;
            self.next();
        }
        Some(self.add1(K::JsxName, start, NONE))
    }

    fn jsx_attribute(&mut self) -> P {
        let start = self.start();
        if self.eat_between(Gap::Space, T::OpenBrace, Gap::None) {
            require(self.eat_between(Gap::None, T::DotDotDot, Gap::None))?;
            let argument = self.spread_argument()?;
            require(self.eat_suffix(T::CloseBrace))?;
            return Some(self.add1(K::JsxSpreadAttr, start, argument));
        }
        let name = self.jsx_name(false)?;
        self.pass(Gap::Space, Gap::Open);
        let mut value = NONE;
        if self.token() == T::Eq {
            self.lx.next_jsx_attribute_value();
            value = match self.token() {
                T::Str if self.start() == self.lx.at.prev_end => {
                    let value = self.leaf(K::JsxStr);
                    let text = self.text(value);
                    self.odd_if(
                        text.first() != Some(&self.style.jsx_quote)
                            || strings::contains_char(text, b'&'),
                    );
                    value
                }
                T::OpenBrace => self.jsx_container(Some(name))?,
                _ => return None,
            };
        }
        let id = self.add2(K::JsxAttr, start, name, value);
        if self.tailwind.is_some() {
            self.check_classes_in_attribute(id)?;
        }
        Some(id)
    }

    /// `attribute`: the name of the one whose value it is
    fn jsx_container(&mut self, attribute: Option<Id>) -> P {
        let is_child = attribute.is_none();
        let may_be_css = attribute.is_none_or(|it| self.text(it) == b"css");
        let start = self.start();
        self.pass_prefix();
        let e = match self.token() {
            T::CloseBrace if is_child => NONE,
            _ => self.assignment()?,
        };
        require(self.token() == T::CloseBrace)?;
        if may_be_css && self.kind(e) == K::Template {
            self.flag(e, flag::ODD);
            self.odd();
        }
        self.leave_jsx(is_child);
        Some(self.add1(K::JsxContainer, start, e))
    }

    /// Up to the `<` of the closing tag.
    fn jsx_children(&mut self) -> P<()> {
        loop {
            require(self.lx.wasted < self.budget)?;
            let child = match self.token() {
                T::JsxText => {
                    let id = self.leaf_without_next(K::JsxText);
                    self.lx.next_jsx_child();
                    id
                }
                T::OpenBrace => self.jsx_container(None)?,
                T::Lt if self.lx.src.get(self.lx.at.end as usize) == Some(&b'/') => {
                    return Some(());
                }
                T::Lt => self.jsx_element(true)?,
                _ => return None,
            };
            self.push(child);
        }
    }
}
