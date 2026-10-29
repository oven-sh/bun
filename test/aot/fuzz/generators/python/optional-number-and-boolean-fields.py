#!/usr/bin/env python3
"""optional-number-and-boolean-fields.py <seed>: optional and nullable number and boolean fields of records and classes, tested in every way a program tests them, for every value the type admits and every way the field can come to be absent. The seed picks the type of the field.
As plain Bun, line by line."""
TYPES = [("x?: number", ["absent", "undefined", "0", "-0", "NaN", "1", "-1", "1.5", "2147483648", "Infinity"]), ("x: number | undefined", ["undefined", "0", "-0", "NaN", "1", "1.5"]), ("x: number | null", ["null", "0", "-0", "NaN", "1", "1.5"]), ("x?: number | null", ["absent", "undefined", "null", "0", "-0", "NaN", "7"]), ("x: number | null | undefined", ["undefined", "null", "0", "NaN", "7.25"]),
         ("x?: boolean", ["absent", "undefined", "true", "false"]), ("x: boolean | undefined", ["undefined", "true", "false"]), ("x: boolean | null", ["null", "true", "false"]), ("x?: boolean | null", ["absent", "undefined", "null", "true", "false"])]
TESTS = ["o.x ? 'yes' : 'no'", "!o.x", "!!o.x", "o.x === undefined", "o.x !== undefined", "o.x === null", "o.x == null", "o.x != null", "o.x == undefined", "typeof o.x", "typeof o.x === 'number'", "typeof o.x === 'undefined'", "typeof o.x === 'boolean'", "typeof o.x === 'object'", "o.x ?? 'fallback'", "o.x || 'fallback'", "o.x && 'then'", "'x' in o", "Object.keys(o).join()", "JSON.stringify(o)", "o.x === void 0 ? 'void' : String(o.x)",
         "o.x === 0", "o.x === false", "Object.is(o.x, -0)", "Object.is(o.x, undefined)", "Number.isNaN(o.x as number)", "o.x !== o.x", "String(o.x)", "`${o.x}`", "[o.x].length + String([o.x][0])", "(() => { if (o.x) return 'a'; else if (o.x === undefined) return 'b'; else if (o.x === null) return 'c'; return 'd'; })()", "(() => { let n = 0; for (let i = 0; i < 3; i++) if (o.x !== undefined && o.x !== null) n++; return n; })()", "(() => { const v = o.x; return v === undefined ? 'u' : v === null ? 'n' : typeof v; })()", "(() => { switch (o.x) { case undefined: return 'u'; case null: return 'n'; case 0: return 'zero'; case true: return 't'; default: return 'other'; } })()", "(() => { while (!o.x) return 'falsy'; return 'truthy'; })()"]
NUMBER_ONLY = ["typeof o.x === 'number' ? o.x + 1 : 'none'", "o.x !== undefined && o.x !== null ? o.x * 2 : 'none'", "(o.x ?? 5) + 1", "(o.x || 5) + 1", "o.x != null && o.x > 0", "o.x! + 1", "Math.max(o.x ?? -1, 0)", "o.x === undefined ? -1 : o.x === null ? -2 : o.x | 0"]
out = ["// @ts-nocheck-free: this file type-checks", "const lines: string[] = [];", "const show = (v: unknown): string => v === undefined ? '<undefined>' : v === null ? '<null>' : typeof v === 'number' ? (Object.is(v, -0) ? '<-0>' : String(v)) : String(v);",
       "const say = (label: string, f: () => unknown): void => { let r: string; try { r = show(f()); } catch (e) { r = 'throws ' + (e as Error).constructor.name; } console.log(label + ' ==> ' + r); };"]
out[0] = "// @ts-nocheck\n// Optional and nullable number and boolean fields, tested in every way."
k = 0
import sys
t = int(sys.argv[1]); decl, values = TYPES[t]
if True:
    out.append("interface R%d { a: string; %s; z: number }" % (t, decl))
    out.append("class C%d { a = 's'; %s; z = 1; constructor(set: boolean, v?: R%d['x']) { if (set) this.x = v as never; } }" % (t, decl if "?" in decl.split(":")[0] else decl + " = undefined as never", t))
    tests = TESTS + (NUMBER_ONLY if "number" in decl else [])
    for i, test in enumerate(tests):
        k += 1
        out.append("function r%d(o: R%d) { return %s; } function c%d(o: C%d) { return %s; }" % (k, t, test, k, t, test))
        for v in values:
            makes = [("literal", "{ a: 's', z: 1 }" if v == "absent" else "{ a: 's', x: %s, z: 1 }" % v)]
            if v != "absent": makes.append(("assigned", "(() => { const o: R%d = { a: 's', x: %s, z: 1 }; o.x = %s; return o; })()" % (t, values[-1], v)))
            if v == "absent" and "?" in decl.split(":")[0]: makes.append(("deleted", "(() => { const o: R%d = { a: 's', x: %s, z: 1 }; delete o.x; return o; })()" % (t, values[-1])))
            makes.append(("spread", "{ ...(%s as R%d) }" % (makes[0][1], t)))
            for how, text in makes:
                out.append("say(%r, () => r%d(%s));" % ("%s | %s %s | %s" % (decl, how, v, test), k, text))
            out.append("say(%r, () => c%d(new C%d(%s)));" % ("%s | class %s | %s" % (decl, v, test), k, t, "false" if v == "absent" else "true, " + v))
print("\n".join(out))
