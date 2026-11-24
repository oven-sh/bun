//! <https://urlpattern.spec.whatwg.org/#constructor-string-parsing>

use bun_core::EncodedSlice;
use bun_jsc::bindgen::{IntoError, JsHeap, Result};

use super::canonicalize::Encoding;
use super::component::{Component, GroupNames, matches_special_scheme};
use super::parser::Options;
use super::tokenizer::{Policy, TokenType, Tokens, tokenize};
use super::{Components, Kind};

/// In the order of a URL.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum State {
    Init,
    Protocol,
    Authority,
    Username,
    Password,
    /// With the IPv6 bracket depth.
    Hostname(usize),
    Port,
    Pathname,
    Search,
    Hash,
    Done,
}

struct Parser<'i> {
    input: EncodedSlice<'i>,
    tokens: Tokens,
    result: Components<Option<EncodedSlice<'i>>>,
    component_start: usize,
    token_index: usize,
    token_increment: usize,
    protocol_matches_special_scheme: bool,
    state: State,
}

impl<'i> Parser<'i> {
    fn rewind(&mut self) {
        self.token_index = self.component_start;
        self.token_increment = 0;
    }

    fn rewind_and_set_state(&mut self, state: State) {
        self.rewind();
        self.state = state;
    }

    fn has_value(&self, token_index: usize, character: u8) -> bool {
        let value = self.tokens[token_index].value();
        value.len() == 1 && self.input.char_at(value.start) == u16::from(character)
    }

    /// <https://urlpattern.spec.whatwg.org/#is-a-non-special-pattern-char>
    fn is_char_at(&self, token_index: usize, character: u8) -> bool {
        self.tokens.get(token_index).is_some_and(|token| {
            matches!(
                token.kind,
                TokenType::Char | TokenType::EscapedChar | TokenType::InvalidChar
            )
        }) && self.has_value(token_index, character)
    }

    fn is_char(&self, character: u8) -> bool {
        self.is_char_at(self.token_index, character)
    }

    fn is_search_prefix(&self) -> bool {
        if self.is_char(b'?') {
            return true;
        }
        if !self.has_value(self.token_index, b'?') {
            return false;
        }
        self.token_index == 0
            || !matches!(
                self.tokens[self.token_index - 1].kind,
                TokenType::Name | TokenType::Regexp | TokenType::Close | TokenType::Asterisk
            )
    }

    fn component_string(&self) -> EncodedSlice<'i> {
        self.input.substring_with_len(
            self.tokens[self.component_start].index(),
            self.tokens[self.token_index].index(),
        )
    }

    fn change_state(&mut self, new_state: State, skip: usize) {
        let text = Some(self.component_string());
        match self.state {
            State::Init | State::Authority | State::Done => {}
            State::Protocol => self.result[Kind::Protocol] = text,
            State::Username => self.result[Kind::Username] = text,
            State::Password => self.result[Kind::Password] = text,
            State::Hostname(_) => self.result[Kind::Hostname] = text,
            State::Port => self.result[Kind::Port] = text,
            State::Pathname => self.result[Kind::Pathname] = text,
            State::Search => self.result[Kind::Search] = text,
            State::Hash => self.result[Kind::Hash] = text,
        }

        if self.state != State::Init && new_state != State::Done {
            let passes = |skipped| self.state < skipped && skipped < new_state;
            if passes(State::Hostname(0)) {
                self.result[Kind::Hostname].get_or_insert(EncodedSlice::EMPTY);
            }
            if passes(State::Pathname) {
                let is_special = self.protocol_matches_special_scheme;
                let pathname = EncodedSlice::latin1(if is_special { b"/" } else { b"" });
                self.result[Kind::Pathname].get_or_insert(pathname);
            }
            if passes(State::Search) {
                self.result[Kind::Search].get_or_insert(EncodedSlice::EMPTY);
            }
        }

        self.state = new_state;
        self.token_index += skip;
        self.component_start = self.token_index;
        self.token_increment = 0;
    }

    fn end_protocol<'a>(&mut self, heap: &JsHeap<'a>) -> Result<'a, ()> {
        // Unlike the spec, a `:` after what is no protocol pattern is passed over.
        let Ok(protocol) = Component::compile(
            heap,
            self.component_string(),
            Encoding::Protocol,
            Options::DEFAULT,
            &mut GroupNames::new(),
        ) else {
            return heap.check_termination();
        };
        self.protocol_matches_special_scheme = matches_special_scheme(heap, protocol.reg_exp)?;
        if self.is_char_at(self.token_index + 1, b'/')
            && self.is_char_at(self.token_index + 2, b'/')
        {
            self.change_state(State::Authority, 3);
        } else if self.protocol_matches_special_scheme {
            self.change_state(State::Authority, 1);
        } else {
            self.change_state(State::Pathname, 1);
        }
        Ok(())
    }

    fn update_state<'a>(&mut self, heap: &JsHeap<'a>) -> Result<'a, ()> {
        match self.state {
            State::Init if self.is_char(b':') => self.rewind_and_set_state(State::Protocol),
            State::Protocol if self.is_char(b':') => self.end_protocol(heap)?,
            State::Authority if self.is_char(b'@') => self.rewind_and_set_state(State::Username),
            State::Authority
                if self.is_char(b'/') || self.is_search_prefix() || self.is_char(b'#') =>
            {
                self.rewind_and_set_state(State::Hostname(0))
            }
            State::Username if self.is_char(b':') => self.change_state(State::Password, 1),
            State::Username | State::Password if self.is_char(b'@') => {
                self.change_state(State::Hostname(0), 1)
            }
            State::Hostname(depth) if self.is_char(b'[') => self.state = State::Hostname(depth + 1),
            // Unlike the spec, a `]` that closes nothing is passed over.
            State::Hostname(depth @ 1..) if self.is_char(b']') => {
                self.state = State::Hostname(depth - 1)
            }
            State::Hostname(0) if self.is_char(b':') => self.change_state(State::Port, 1),
            State::Hostname(_) | State::Port if self.is_char(b'/') => {
                self.change_state(State::Pathname, 0)
            }
            State::Hostname(_) | State::Port | State::Pathname if self.is_search_prefix() => {
                self.change_state(State::Search, 1)
            }
            State::Hostname(_) | State::Port | State::Pathname | State::Search
                if self.is_char(b'#') =>
            {
                self.change_state(State::Hash, 1)
            }
            _ => {}
        }
        Ok(())
    }
}

pub(super) fn parse<'a, 'i>(
    heap: &JsHeap<'a>,
    input: EncodedSlice<'i>,
) -> Result<'a, Components<Option<EncodedSlice<'i>>>> {
    let mut parser = Parser {
        input,
        tokens: Tokens::new(),
        result: Components::default(),
        component_start: 0,
        token_index: 0,
        token_increment: 1,
        protocol_matches_special_scheme: false,
        state: State::Init,
    };
    tokenize(input, Policy::Lenient, &mut parser.tokens).map_err(|error| error.into_error(heap))?;
    let mut group_depth = 0usize;
    while parser.state != State::Done {
        parser.token_increment = 1;
        match parser.tokens[parser.token_index].kind {
            TokenType::End => match parser.state {
                State::Init => {
                    parser.rewind();
                    if parser.is_char(b'#') {
                        parser.change_state(State::Hash, 1);
                    } else if parser.is_search_prefix() {
                        parser.change_state(State::Search, 1);
                    } else {
                        parser.change_state(State::Pathname, 0);
                    }
                }
                State::Authority => parser.rewind_and_set_state(State::Hostname(0)),
                _ => parser.change_state(State::Done, 0),
            },
            TokenType::Open => group_depth += 1,
            TokenType::Close if group_depth > 0 => {
                group_depth -= 1;
                parser.update_state(heap)?;
            }
            _ if group_depth > 0 => {}
            _ => parser.update_state(heap)?,
        }
        parser.token_index += parser.token_increment;
    }
    if parser.result[Kind::Hostname].is_some() {
        parser.result[Kind::Port].get_or_insert(EncodedSlice::EMPTY);
    }
    Ok(parser.result)
}
