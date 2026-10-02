#!/usr/bin/env python3
# Patched copies of src/js_parser for the neutrality check of the two error-arm hooks. Nothing is written in the worktree.
import os, shutil, sys
SRC = '/workspace/wt/parser/src/js_parser'
ROOT = '/tmp/r5codes/root'
PFX, STMT, SE = 'parse/parse_prefix.rs', 'parse/parse_stmt.rs', 'parse/syntax_errors.rs'
class Tree:
    def __init__(self, tag):
        self.dir = ROOT + '/' + tag + '/src/js_parser'
        if os.path.exists(ROOT + '/' + tag): shutil.rmtree(ROOT + '/' + tag)
        shutil.copytree(SRC, self.dir, ignore=shutil.ignore_patterns('benches'))
    def rep(self, f, old, new, count=1):
        p = self.dir + '/' + f; s = open(p).read()
        assert s.count(old) == count, (f, s.count(old), old[:90])
        open(p, 'w').write(s.replace(old, new))
LAST = "                p.unexpected_as(crate::parse::syntax_errors::EXPRESSION_EXPECTED)?;\n"
MATCH = ("            let expr_or_let = match p.parse_expr_or_let_stmt(opts) {\n"
         "                Ok(expr_or_let) => expr_or_let,\n"
         "                Err(err) => {\n"
         "                    let is_in_list = opts.lexical_decl == LexicalDecl::AllowAll;\n"
         "                    let is_at_top_level = opts.scope.is_module();\n"
         "                    return Err(p.statement_expected(loc, is_in_list, is_at_top_level, err));\n"
         "                }\n"
         "            };\n")
EXPR_FN = ('''    /// The last arm of `parse_prefix`.
    #[cold]
    #[inline(never)]
    pub(crate) fn expression_expected(&mut self) -> Result<(), Error> {
        if SCAN_ONLY || !self.is_lint_parse() {
            return Ok(self.lexer.unexpected()?);
        }
        self.unexpected_as(EXPRESSION_EXPECTED)
    }

    /// `Lexer::unexpected`, where the reference reports `message` for the same token.
''')
def make(tag):
    t = Tree(tag)
    if tag == 'head': pass
    elif tag == 'la0':   # main's last arm
        t.rep(PFX, LAST, "                p.lexer.unexpected()?;\n")
    elif tag == 'la1':   # a cold method without an argument
        t.rep(PFX, LAST, "                p.expression_expected()?;\n")
        t.rep(SE, "    /// `Lexer::unexpected`, where the reference reports `message` for the same token.\n", EXPR_FN)
    elif tag == 'st0':   # main's statement site
        t.rep(STMT, MATCH, "            let expr_or_let = p.parse_expr_or_let_stmt(opts)?;\n")
    elif tag == 'st1':   # map_err in front of the question mark
        t.rep(STMT, MATCH, "            let expr_or_let = p\n                .parse_expr_or_let_stmt(opts)\n                .map_err(|err| p.statement_expected_at(loc, opts, err))?;\n")
        t.rep(SE, "    /// The expression that starts the statement at `loc` failed.", '''    /// `statement_expected` with the options of the statement.
    #[cold]
    #[inline(never)]
    pub(crate) fn statement_expected_at(
        &mut self,
        loc: Loc,
        opts: &crate::parser::ParseStatementOptions<'a>,
        err: Error,
    ) -> Error {
        let is_in_list = opts.lexical_decl == crate::parser::LexicalDecl::AllowAll;
        self.statement_expected(loc, is_in_list, opts.scope.is_module(), err)
    }

    /// The expression that starts the statement at `loc` failed.''')
    elif tag == 'both0':  # both sites as on main
        t.rep(PFX, LAST, "                p.lexer.unexpected()?;\n")
        t.rep(STMT, MATCH, "            let expr_or_let = p.parse_expr_or_let_stmt(opts)?;\n")
    else: raise SystemExit('unknown ' + tag)
    print('made', tag)
for tag in sys.argv[1:]: make(tag)
