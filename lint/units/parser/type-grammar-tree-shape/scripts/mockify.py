#!/usr/bin/env python3
"""mockify.py <in> <out>: the file as the mock compiles it: skip_type_script_type_stmt, which records erased statements, has no body."""
import sys
s = open(sys.argv[1]).read()
a = s.index("    pub(crate) fn skip_type_script_type_stmt(")
b = s.index(") -> Result<(), Error> {\n", a) + len(") -> Result<(), Error> {\n")
e = s.index("\n    }\n", b)
s = s[:b] + "        let _ = opts.is_export;\n        Ok(())" + s[e:]
open(sys.argv[2], "w").write(s)
