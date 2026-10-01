#!/bin/sh
P=/workspace/notes/lint/units/parser/measure/sizeprobe-a
O=/workspace/notes/lint/measure/parser/baseline/sizes-a
"$P/incrate.sh" head be1ebe5295 /workspace/wt/parser /workspace/wt/parser/build/debug/codegen "$O" "ParserSnapshot<'static>" "SidecarMark" "Option<SidecarMark>" "js_lexer::LexerSnapshot<'static>" "FnOrArrowDataParse" "crate::parse::erased::ErasedMark" "crate::parse::attached::AttachedMark"; a=$?
"$P/incrate.sh" base e3566be889 /workspace/wt/parser /tmp/parser-bb/base-codegen "$O" "ParserSnapshot<'static>" "js_lexer::LexerSnapshot<'static>" "FnOrArrowDataParse"; b=$?
exit $(( a + b ))
