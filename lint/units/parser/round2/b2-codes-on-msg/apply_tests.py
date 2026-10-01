#!/usr/bin/env python3
"""Replaces `mod tests` of a COPY of src/js_parser/parse/syntax_errors.rs with tests_module.rs. usage: apply_tests.py <copy of src/js_parser>"""
import sys, pathlib
here = pathlib.Path(__file__).resolve().parent
p = pathlib.Path(sys.argv[1]) / "parse/syntax_errors.rs"
s = p.read_text()
marker = "\n#[cfg(test)]\nmod tests {\n"
if s.count(marker) != 1:
    sys.exit("no single test module")
s = s[: s.index(marker) + 1] + (here / "tests_module.rs").read_text()
p.write_text(s)
print("tests replaced in", p)
