#!/usr/bin/env python3
"""module_form8.py <typed CommonJS text in> <text out: name it .ts> [--opaque=index|empty|object|unknown|any|keep]: THE MODULE's FORM of a CommonJS production bundle that is compiled as TypeScript: IT BECOMES AN ES MODULE.
WHY: in TypeScript's meaning `module.exports = ..` and `exports.x = ..` export nothing (the importer: TS1192; `exports`, `module`, `require` are no names); a `require(..)` is not linked into the program ("RequireExternalModule"); `export = ` and `import X = require(..)` are "not compiled yet" (imports.rs :698). `export default`, `export { .. }` and ES imports are built and run in the whole Bun.
WHAT IS REWRITTEN, AND NOTHING ELSE. No line is added or taken away inside the text: lines stay.
 1. `/// <reference path="./X.d.ts" />` on the leading lines (one line or many: every line ahead of the first that holds anything else): taken off the lines, which stay, empty; THE TEXT OF EACH X.d.ts IS APPENDED, so that the shapes are the module's own names and no globals of the whole program.
    **AND IT IS MADE NON-AMBIENT: `declare namespace N {` -> `namespace N {`, with `export ` ahead of every `interface` | `type` that stands two spaces in. A TYPE DECLARED IN AN AMBIENT CONTEXT (any .d.ts, a `declare namespace`) GIVES NO LAYOUT IN OUR FRONT END: no Record, `new` is a generic Construct, a literal a plain NewObject; the same text not ambient gives them all.**
    **AND AN `interface X { .. }` AT THE TOP OF A SHAPES FILE, ON ONE LINE OR MANY (ErrorConstructor, Error, CallableFunction twice), IS WRAPPED IN `declare global { }`: appended to a module it would be the module's own and augment nothing.**
    **AND THE OPAQUE BRANDS ARE SWAPPED (--opaque, `empty` unless said): `interface N { readonly $$rrX?: never }` -> `interface N { [name: string]: unknown }` (index: the find of piece 11's annotator: an interface has no implicit index signature, so none of our shapes is assignable to it and narrowing by assignment holds; every object is admitted) | `interface N {}` | `type N = object;` | `= unknown;` | `= any;`. THE BRAND LIVES BY TypeScript's WEAK-TYPE RULE, WHICH KEEPS EVERY HOST OBJECT OUT TOO, AND OUR RUN-TIME TEST ASKS THE CHECKER's RELATION: "TypeError: expected HostObject, got Box". It does its work in the check of the CommonJS text; here it must go until the front end asks without that rule.**
 2. `require("<name>")` anywhere -> `(<name>$module as any)`; `import * as <name>$module from "<name>";` is appended (a namespace: it serves a package that is still CommonJS and one that is an ES module alike).
 A BUNDLE THAT SAYS `module.exports = ` at the start of a line (the reconciler):
 3. that, once -> `export default `; every later line that starts with `module.exports` or `Object.defineProperty(module.exports` -> `//` ahead of it.
 A BUNDLE THAT SAYS `exports.NAME` (react, jsx-runtime, compiler-runtime, scheduler):
 4. every `exports.NAME` -> `NAME$x`; the first line that STARTS with `exports.NAME = ` gets `var ` ahead of it; appended: `export { NAME$x as NAME, .. };` and `export default { NAME: NAME$x, .. };` in the order of those first lines.
PRINTS the number of rewrites of each kind. It lays 2, 3 and 4 back by itself and refuses to write unless that gives the text that came in (less the first line's references)."""
import os, re, sys
OPAQUE = "empty"
def name_of(spec): return re.sub(r"\W", "_", spec) + "$module"
REFERENCE = r'///\s*<reference path="([^"]+)"\s*/>\s*'; REQUIRE = r'(?<![\w$.])require\("([^"\n]+)"\)'; EXPORTS = r"(?<![\w$.])exports\.([A-Za-z_$][\w$]*)"
def not_ambient(text, count):
    out = []; inside = False; augmenting = False
    for line in text.split("\n"):
        if re.match(r"declare namespace [\w$]+ \{\s*$", line): inside = True; line = line[len("declare "):]; count["namespaces"] += 1
        elif inside and line.startswith("}"): inside = False
        elif augmenting and line.startswith("}"): augmenting = False; line = line + " }"
        elif not inside and not augmenting and re.match(r"interface [\w$]+(<[^>]*>)? \{\s*(//.*)?$", line): augmenting = True; line = "declare global { " + line; count["global augmentations"] += 1
        elif not inside and re.match(r"interface [\w$]+(<[^>]*>)? \{.*\}\s*(//.*)?$", line): line = "declare global { " + re.sub(r"\s*//.*$", "", line) + " }"; count["global augmentations"] += 1
        elif inside and re.match(r"  (interface|type) ", line):
            brand = re.match(r"  interface ([\w$]+) \{ readonly \$\$rr\w+\?: never \}(.*)$", line)
            if brand and OPAQUE != "keep": line = "  " + ("interface %s { [name: string]: unknown }" if OPAQUE == "index" else "interface %s {}" if OPAQUE == "empty" else "type %s = " + OPAQUE + ";") % brand.group(1) + brand.group(2); count["brands"] += 1
            line = "  export " + line[2:]; count["shapes"] += 1
        out.append(line)
    return "\n".join(out)
def do(text, folder):
    lines = text.split("\n"); count = {"references": 0, "namespaces": 0, "shapes": 0, "brands": 0, "global augmentations": 0, "require": 0, "the export": 0, "left out": 0, "exports.NAME": 0, "var": 0}; specs = []; names = []; shapes = []
    def reference(m):
        count["references"] += 1; shapes.append(not_ambient(open(os.path.join(folder, m.group(1))).read().rstrip("\n"), count)); return ""
    for i, line in enumerate(lines):
        rest = re.sub(REFERENCE, reference, line)
        if rest == line: break
        lines[i] = rest
        if rest.strip(): break
    whole = any(l.startswith("module.exports = ") for l in lines); seen = False
    for i, line in enumerate(lines):
        if whole and line.startswith("module.exports = ") and not seen:
            line = "export default " + line[len("module.exports = "):]; seen = True; count["the export"] += 1
        elif whole and seen and re.match(r"(module\.exports\b|Object\.defineProperty\(module\.exports\b)", line):
            lines[i] = "//" + line; count["left out"] += 1; continue
        def one(m):
            if m.group(1) not in specs: specs.append(m.group(1))
            count["require"] += 1; return "(%s as any)" % name_of(m.group(1))
        line = re.sub(REQUIRE, one, line)
        if not whole:
            first = re.match(r"exports\.([A-Za-z_$][\w$]*) =(?!=)", line)
            def name(m): count["exports.NAME"] += 1; return m.group(1) + "$x"
            line = re.sub(EXPORTS, name, line)
            if first and first.group(1) not in names: names.append(first.group(1)); line = "var " + line; count["var"] += 1
        lines[i] = line
    tail = ['import * as %s from "%s";' % (name_of(s), s) for s in specs]
    if names: tail += ["export { %s };" % ", ".join("%s$x as %s" % (n, n) for n in names), "export default { %s };" % ", ".join("%s: %s$x" % (n, n) for n in names)]
    return "\n".join(lines), tail + shapes, count, specs, names
def back(body, specs, names):
    lines = body.split("\n"); given = set()
    for i, line in enumerate(lines):
        if line.startswith("export default "): line = "module.exports = " + line[len("export default "):]
        elif re.match(r"//(module\.exports\b|Object\.defineProperty\(module\.exports\b)", line): line = line[2:]
        m = re.match(r"var ([A-Za-z_$][\w$]*)\$x =(?!=)", line)
        if m and m.group(1) in names and m.group(1) not in given: given.add(m.group(1)); line = line[4:]
        for s in specs: line = line.replace("(%s as any)" % name_of(s), 'require("%s")' % s)
        lines[i] = re.sub(r"(?<![\w$.])([A-Za-z_$][\w$]*)\$x\b", lambda m: "exports." + m.group(1), line)
    return "\n".join(lines)
if __name__ == "__main__":
    options = [a for a in sys.argv[1:] if a.startswith("--opaque=")]; sys.argv = [a for a in sys.argv if a not in options]
    if options: OPAQUE = options[0].split("=")[1]
    if len(sys.argv) != 3 or OPAQUE not in ("index", "empty", "object", "unknown", "any", "keep"): sys.exit(__doc__)
    text = open(sys.argv[1]).read()
    if "$module" in text or re.search(r"\$x\b", text): sys.exit("module_form8: the text has `$module` or `$x` in it already")
    body, tail, count, specs, names = do(text, os.path.dirname(os.path.abspath(sys.argv[1])))
    came = text.split("\n")
    for i, line in enumerate(came):
        rest = re.sub(REFERENCE, "", line)
        if rest == line: break
        came[i] = rest
        if rest.strip(): break
    if back(body, specs, names) != "\n".join(came): sys.exit("module_form8: laid back, the text is not what came in: nothing is written")
    open(sys.argv[2], "w").write(body.rstrip("\n") + "\n" + "\n".join(tail) + "\n")
    print("module_form8: " + " · ".join("%s %d" % kv for kv in count.items() if kv[1]) + " · laid back it is the text that came in: yes")
