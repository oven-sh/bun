#!/usr/bin/env python3
"""mock_sink.py <type_sink.rs of the repo> <out>: the trait and the two sinks that keep nothing of a tree, for the mock."""
import sys
s = open(sys.argv[1]).read()
cut = s.index("/// Builds the nodes of `bun_ast::ts`, in the arena of the parse.")
s = s[:cut]
head_end = s.index("/// What the type grammar keeps of the syntax it reads.")
s = """use crate::Error;
use crate::lexer::Lexer;
use bun_ast::Ref;
use bun_ast::ts;
use bun_ast::ts::Metadata;
#[allow(unused_imports)]
use bun_ast::op::Level;

""" + s[head_end:]
open(sys.argv[2], "w").write(s)
