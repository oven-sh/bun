#!/bin/sh
# Probes of the research on comment capture (round 2, B1). Run from this directory.
# tsc 6.0.2 comment ranges (UTF-8 byte offsets, kind) of each input: must print expected.txt / expected2.txt.
node ../../lexer-lint-hooks/bottom-up/comments-oracle.cjs inputs.json
node ../../lexer-lint-hooks/bottom-up/comments-oracle.cjs inputs2.json
# tsc 6.0.2 pos / start / end of every node and list of each input: must print nodes.expected.txt / nodes2.expected.txt.
node nodes.cjs inputs.json
node nodes.cjs inputs2.json
# What tsc reports for `-->` at the start of a line: must print legacy-html-close.tsc602.txt.
node legacy-html-close.cjs
# Which comments a minified parse WITHOUT lint subtracts: `z` = the comment is not in Lexer::all_comments.
#   <bun> minify-dropped-comments.mjs out.json   (compare with the two saved .json files)
# Which inputs of the two older oracle files a parse without lint takes: <bun> oracle-inputs-parse.mjs
# Guard of the minified output beside comments in JSX tags: <bun> ../../lexer-lint-hooks/top-down/minify-guard.mjs | cut -c1-30
#   must print minify-guard.head-be1ebe5295.locals.txt
