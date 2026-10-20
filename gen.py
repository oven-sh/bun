# usage: gen.py <declaration> <n> <out.css>  → one rule with n copies of the declaration
import sys
decl, n, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
open(out, "w").write(".a{" + ";".join([decl] * n) + "}\n")
