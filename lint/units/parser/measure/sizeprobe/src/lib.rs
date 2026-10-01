// Size probe: every line fails with E0308 and the message names the size ("found one with a size of N").
// One type per line: run.sh maps the line number of each error back to the type.
#![allow(unused)]
use bun_ast::{E, G};
use bun_js_parser::lexer::{Lexer, LexerSnapshot};
use bun_js_parser::p::StartsForParseOnly;
use bun_js_parser::{P, ParserOptions};
const _: [(); 0] = [(); core::mem::size_of::<P<'static, true, false>>()];
const _: [(); 0] = [(); core::mem::size_of::<P<'static, false, false>>()];
const _: [(); 0] = [(); core::mem::size_of::<P<'static, true, true>>()];
const _: [(); 0] = [(); core::mem::size_of::<P<'static, false, true>>()];
const _: [(); 0] = [(); core::mem::align_of::<P<'static, true, false>>()];
const _: [(); 0] = [(); core::mem::size_of::<Lexer<'static>>()];
const _: [(); 0] = [(); core::mem::size_of::<LexerSnapshot<'static>>()];
const _: [(); 0] = [(); core::mem::size_of::<bun_ast::Msg>()];
const _: [(); 0] = [(); core::mem::size_of::<bun_ast::Expr>()];
const _: [(); 0] = [(); core::mem::size_of::<bun_ast::Stmt>()];
const _: [(); 0] = [(); core::mem::size_of::<bun_ast::Binding>()];
const _: [(); 0] = [(); core::mem::size_of::<E::Arrow>()];
const _: [(); 0] = [(); core::mem::size_of::<G::Decl>()];
const _: [(); 0] = [(); core::mem::size_of::<G::Arg>()];
const _: [(); 0] = [(); core::mem::size_of::<G::Fn>()];
const _: [(); 0] = [(); core::mem::size_of::<G::Property>()];
const _: [(); 0] = [(); core::mem::size_of::<G::Class>()];
const _: [(); 0] = [(); core::mem::size_of::<G::FnBody>()];
const _: [(); 0] = [(); core::mem::size_of::<E::Function>()];
const _: [(); 0] = [(); core::mem::size_of::<bun_ast::ts::Metadata>()];
const _: [(); 0] = [(); core::mem::size_of::<bun_ast::Metadata>()];
const _: [(); 0] = [(); core::mem::size_of::<bun_ast::Data>()];
const _: [(); 0] = [(); core::mem::size_of::<bun_ast::Log>()];
const _: [(); 0] = [(); core::mem::size_of::<bun_ast::Symbol>()];
const _: [(); 0] = [(); core::mem::size_of::<StartsForParseOnly>()];
const _: [(); 0] = [(); core::mem::size_of::<Option<Box<StartsForParseOnly>>>()];
const _: [(); 0] = [(); core::mem::size_of::<ParserOptions<'static>>()];
