#!/usr/bin/env python3
"""R1 = V2BH (head + the grammar fast paths) + three edits outside the type grammar. usage: patch_r1.py <root>
 A. parse_stmt_named_like_cast: the bytes after the keyword are looked at before a token is read ahead.
 B. parse_fn: the comma after a rest argument is tested only where a body may be missing.
 C. parse_fn: the modifier of a parameter property is tested only where neither ":" nor "?" follows the name."""
import sys
root = sys.argv[1] + '/src/js_parser/'
def sub(path, old, new, count=1):
    s = open(root + path).read()
    assert s.count(old) == count, (path, old[:70], s.count(old))
    open(root + path, 'w').write(s.replace(old, new))
# A
sub('parse/parse_stmt.rs', """        let is_named_like_cast = p.next_token_matches(|p| {""", """        // The bytes after the keyword tell without a token that no cast follows.
        if !p.may_be_followed_by_cast_word() {
            return Ok(None);
        }
        let is_named_like_cast = p.next_token_matches(|p| {""")
sub('parse/parse_stmt.rs', """    /// Whether a parse without lint reads that declaration too:""", """    /// Whether "as" or "satisfies" may be the token after the current one on its line: false where the first byte past blanks starts neither word and no comment.
    #[inline]
    fn may_be_followed_by_cast_word(&self) -> bool {
        let contents = self.lexer.contents;
        let mut i = self.lexer.end;
        while matches!(contents.get(i), Some(b' ' | b'\\t')) {
            i += 1;
        }
        match contents.get(i) {
            Some(b'a' | b's' | b'/' | b'\\\\' | 0x0B | 0x0C) => true,
            Some(byte) => *byte >= 0x80,
            None => false,
        }
    }

    /// Whether a parse without lint reads that declaration too:""")
# B
sub('parse/parse_fn.rs', """        if opts.allow_missing_body_for_type_script && p.lexer.token != T::TOpenBrace {
            p.lexer.expect_or_insert_semicolon()?;
            func.flags.insert(Flags::Function::IsForwardDeclaration);
            return Ok(func);
        }
        if rest_comma.len > 0 {
            p.log().add_range_error(
                Some(p.source),
                rest_comma,
                b"Expected \\")\\" but found \\",\\"",
            );
        }
""", """        if opts.allow_missing_body_for_type_script {
            if p.lexer.token != T::TOpenBrace {
                p.lexer.expect_or_insert_semicolon()?;
                func.flags.insert(Flags::Function::IsForwardDeclaration);
                return Ok(func);
            }
            // Only a signature that may lack its body read a comma after a rest argument.
            if rest_comma.len > 0 {
                p.log().add_range_error(
                    Some(p.source),
                    rest_comma,
                    b"Expected \\")\\" but found \\",\\"",
                );
            }
        }
""")
# C
sub('parse/parse_fn.rs', """                if is_identifier && (opts.is_constructor || !rest_arg) {""", """                if p.lexer.token != T::TColon
                    && p.lexer.token != T::TQuestion
                    && is_identifier
                    && (opts.is_constructor || !rest_arg)
                {""")
print('r1 patched')
