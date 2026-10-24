#!/usr/bin/env python3
"""share_elements1.py <the reconciler's text behind module_form8 and given2> <out .ts> [--react=../../react]: ONE LAYOUT FOR AN ELEMENT: `RR.ReactElement` BECOMES THE jsx-runtime's OWN DECLARATION.
`  export interface ReactElement { .. }` in namespace RR  ->  `  export type ReactElement = $jsx.ReactElement;`, and `import type * as $jsx from "<react>/cjs/react-jsx-runtime.production.ts";` is appended. The path is RELATIVE to react-reconciler/cjs/ ("react/jsx-runtime" resolves to @types for the checker): ../../react where react and react-reconciler are neighbours in one node_modules.
IT WANTS THE TYPED jsx-runtime LAID `export interface ReactElement`, live) AND ReactElement KEPT LIVE BY given2 (--live=..,ReactElement).
MEASURED: the given shapes any, elements plain 10,943.5 | 3,659.4 · elements laid out and read through any 11,121.3 | 3,708.1 · THIS 10,999.6 | 3,703.2 · this + the elements' device 10,807.8 | 3,529.3."""
import re, sys
args = [a for a in sys.argv[1:] if not a.startswith("--")]; opts = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--"))
t = open(args[0]).read(); m = re.findall(r"^  export interface ReactElement \{[^\n]*\}[^\n]*$", t, re.M)
if len(m) != 1: sys.exit("share_elements1: `  export interface ReactElement { .. }` on one line: %d times, 1 is due (was it kept live?)" % len(m))
open(args[1], "w").write(t.replace(m[0], "  export type ReactElement = $jsx.ReactElement;").rstrip("\n") + '\nimport type * as $jsx from "%s/cjs/react-jsx-runtime.production.ts";\n' % opts.get("react", "../../react"))
print("share_elements1: RR.ReactElement is the jsx-runtime's own; the import of its types is appended")
