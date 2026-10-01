#!/usr/bin/env python3
"""V2b = V2 + the same kind of reading for members, parameters of signatures and types that start with a bracket. usage: patch_v2b.py <root>"""
import sys
root = sys.argv[1] + '/src/js_parser/'
def sub(path, old, new, count=1):
    s = open(root + path).read()
    assert s.count(old) == count, (path, old[:70], s.count(old))
    open(root + path, 'w').write(s.replace(old, new))
F = 'parse/parse_skip_typescript.rs'

# i. a member `name: type` or `name(parameters): type`
sub(F, """        if self.lexer.token == T::TIdentifier && MEMBER_KEYWORD_MAP.get(self.lexer.raw()).is_none() {
            self.lexer.next()?;
            return self.parse_property_or_method_signature(MemberName::Word, false);
        }""", """        if self.lexer.token == T::TIdentifier && MEMBER_KEYWORD_MAP.get(self.lexer.raw()).is_none() {
            self.lexer.next()?;
            match self.lexer.token {
                T::TColon => {
                    self.lexer.next()?;
                    self.skip_type_script_type(Level::Lowest)?;
                    if self.lexer.token == T::TEquals {
                        self.parse_initializer_in_type()?;
                    }
                    return self.parse_type_member_semicolon();
                }
                T::TOpenParen => {
                    self.skip_typescript_fn_args()?;
                    if self.lexer.token == T::TColon {
                        self.lexer.next()?;
                        self.skip_typescript_return_type()?;
                    }
                    return self.parse_type_member_semicolon();
                }
                _ => return self.parse_property_or_method_signature(MemberName::Word, false),
            }
        }""")

# ii. the separator of members: ";" and "," first
sub(F, """    fn parse_type_member_semicolon(&mut self) -> Result<(), Error> {
        match self.lexer.token {""", """    fn parse_type_member_semicolon(&mut self) -> Result<(), Error> {
        if self.lexer.token == T::TSemicolon || self.lexer.token == T::TComma {
            return self.lexer.next().map_err(Into::into);
        }
        match self.lexer.token {""")

# iii. parameters of a signature: the modifier and the initializer are tested where neither "," nor ")" follows
sub(F, """            // "(public a)"
            if is_identifier && self.lexer.token == T::TIdentifier {
                self.skip_type_script_parameter_modifiers(name)?;
            }

            // "(a?)"
            if self.lexer.token == T::TQuestion {
                self.lexer.next()?;
            }

            // "(a: any)"
            if self.lexer.token == T::TColon {
                self.lexer.next()?;
                self.skip_type_script_type(Level::Lowest)?;
            }

            // "(a = 1)"
            if self.lexer.token == T::TEquals {
                self.parse_initializer_in_type()?;
            }

            // "(a, b)"
            if self.lexer.token != T::TComma {
                break;
            }
""", """            let mut is_at_binding = is_identifier;
            loop {
                // "(a?)"
                if self.lexer.token == T::TQuestion {
                    self.lexer.next()?;
                    is_at_binding = false;
                }

                // "(a: any)"
                if self.lexer.token == T::TColon {
                    self.lexer.next()?;
                    self.skip_type_script_type(Level::Lowest)?;
                    is_at_binding = false;
                }

                if self.lexer.token == T::TComma || self.lexer.token == T::TCloseParen {
                    break;
                }

                // "(public a)"
                if is_at_binding && self.lexer.token == T::TIdentifier {
                    is_at_binding = false;
                    self.skip_type_script_parameter_modifiers(name)?;
                    continue;
                }

                // "(a = 1)"
                if self.lexer.token == T::TEquals {
                    self.parse_initializer_in_type()?;
                }
                break;
            }

            // "(a, b)"
            if self.lexer.token != T::TComma {
                break;
            }
""")

# iv. a type that starts with "{", "[" or "("
sub(F, """            _ => Ok(Plain::No),
        }
    }
""", """            T::TOpenBrace => {
                self.skip_type_script_object_type()?;
                S::object_type(out);
                self.parse_postfix_type_rest::<S>(out)?;
                Ok(Plain::More)
            }
            T::TOpenBracket => {
                self.parse_tuple_type::<S>(out)?;
                self.parse_postfix_type_rest::<S>(out)?;
                Ok(Plain::More)
            }
            T::TOpenParen => {
                self.skip_type_script_paren_or_fn_type::<S>(out)?;
                self.parse_postfix_type_rest::<S>(out)?;
                Ok(Plain::More)
            }
            _ => Ok(Plain::No),
        }
    }
""")
print('v2b patched')
