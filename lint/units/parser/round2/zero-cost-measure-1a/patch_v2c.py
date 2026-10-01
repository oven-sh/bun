#!/usr/bin/env python3
"""V2c = V2 + V2b + a member whose word is followed by ":" or "(" is read without asking whether the word is a modifier.
usage: patch_v2c.py <root with patch_v2.py and patch_v2b.py applied>"""
import sys
root = sys.argv[1] + '/src/js_parser/'
def sub(path, old, new, count=1):
    s = open(root + path).read()
    assert s.count(old) == count, (path, old[:70], s.count(old))
    open(root + path, 'w').write(s.replace(old, new))
F = 'parse/parse_skip_typescript.rs'
sub(F, """        if self.lexer.token == T::TIdentifier && MEMBER_KEYWORD_MAP.get(self.lexer.raw()).is_none() {
            self.lexer.next()?;
            match self.lexer.token {""", """        if self.lexer.token == T::TIdentifier {
            // Before ":" and "(" every word is the name, a modifier too.
            let word = self.lexer.raw();
            self.lexer.next()?;
            match self.lexer.token {""")
sub(F, """                    return self.parse_type_member_semicolon();
                }
                _ => return self.parse_property_or_method_signature(MemberName::Word, false),
            }
        }""", """                    return self.parse_type_member_semicolon();
                }
                _ => {}
            }
            return match self.parse_modifiers_of_type_member_after(word)? {
                AfterModifiers::Name => {
                    self.parse_property_or_method_signature(MemberName::Word, false)
                }
                AfterModifiers::Accessor => self.parse_accessor_declaration(),
                AfterModifiers::Member => self.parse_type_member_after_modifiers(),
            };
        }""")
sub(F, """            AfterModifiers::Accessor => self.parse_accessor_declaration(),
            AfterModifiers::Member => {
                if self.lexer.token == T::TOpenBracket {""", """            AfterModifiers::Accessor => self.parse_accessor_declaration(),
            AfterModifiers::Member => self.parse_type_member_after_modifiers(),
        }
    }

    /// parseTypeMember after its modifiers: "[", a name or a signature.
    fn parse_type_member_after_modifiers(&mut self) -> Result<(), Error> {
        {
            {
                if self.lexer.token == T::TOpenBracket {""")
sub(F, """    fn parse_modifiers_of_type_member(&mut self) -> Result<AfterModifiers, Error> {
        let mut has_static = false;
        loop {""", """    fn parse_modifiers_of_type_member(&mut self) -> Result<AfterModifiers, Error> {
        self.parse_modifiers_of_type_member_from(false)
    }

    /// `parse_modifiers_of_type_member` where `word` was read as the first word of the member and the lexer is after it.
    #[cold]
    fn parse_modifiers_of_type_member_after(
        &mut self,
        word: &'a [u8],
    ) -> Result<AfterModifiers, Error> {
        let Some(keyword) = MEMBER_KEYWORD_MAP.get(word).copied() else {
            return Ok(AfterModifiers::Name);
        };
        let can_follow = match keyword {
            MemberKeyword::Accessor => {
                if self.lexer.token == T::TOpenBracket || self.is_literal_property_name() {
                    return Ok(AfterModifiers::Accessor);
                }
                return Ok(AfterModifiers::Name);
            }
            MemberKeyword::Static => self.can_follow_modifier(),
            MemberKeyword::Modifier => {
                !self.lexer.has_newline_before && self.can_follow_modifier()
            }
        };
        if !can_follow {
            return Ok(AfterModifiers::Name);
        }
        self.parse_modifiers_of_type_member_from(matches!(keyword, MemberKeyword::Static))
    }

    fn parse_modifiers_of_type_member_from(
        &mut self,
        mut has_static: bool,
    ) -> Result<AfterModifiers, Error> {
        loop {""")
print('v2c patched')
