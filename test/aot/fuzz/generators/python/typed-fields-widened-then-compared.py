#!/usr/bin/env python3
"""typed-fields-widened-then-compared.py: one program, whatever the seed: a field of a declared type (string literals, enums, numbers, booleans, bigints, optional and nullable ones) is read into a
place of a wider type and then compared, tested or printed. Every function is called through an array, so that it is compiled by itself. As plain Bun, line by line."""
FIELDS = [  # name, type, values, constants to compare with
    ("lit", '"m" | "f"', ['"m"', '"f"'], ['"f"', '"m"', '"x"']),
    ("long", '"first" | "second" | "third"', ['"first"', '"third"'], ['"first"', '"third"', '"none"']),
    ("wide", '"\\u05e6\\u05e8" | "\\u05e6"', ['"\\u05e6\\u05e8"', '"\\u05e6"'], ['"\\u05e6\\u05e8"', '"\\u05e6"']),
    ("empty", '"" | "a"', ['""', '"a"'], ['""', '"a"']),
    ("optlit", '"m" | "f" | undefined', ['"m"', '"f"', 'undefined'], ['"f"', 'undefined']),
    ("nulllit", '"m" | "f" | null', ['"m"', 'null'], ['"m"', 'null']),
    ("str", 'string', ['"m"', '"f"', '""'], ['"f"', '""']),
    ("num", 'number', ['1', '2.5', '0', 'NaN', '-0'], ['1', '2.5', '0']),
    ("int", '1 | 2 | 3', ['1', '3'], ['1', '3', '4']),
    ("optnum", 'number | undefined', ['1', 'undefined'], ['1', 'undefined']),
    ("bool", 'boolean', ['true', 'false'], ['true', 'false']),
    ("yes", 'true | undefined', ['true', 'undefined'], ['true', 'undefined']),
    ("big", 'bigint', ['1n', '2n'], ['1n', '3n']),
    ("mixed", '"a" | 1 | true', ['"a"', '1', 'true'], ['"a"', '1', 'true']),
    ("color", 'Color', ['Color.Red', 'Color.Blue'], ['Color.Red', 'Color.Blue']),
    ("level", 'Level', ['Level.Low', 'Level.High'], ['Level.Low', 'Level.High']),
]
WIDER = {"lit": ["string", "unknown", "string | undefined", "string | number"], "long": ["string", "unknown"], "wide": ["string", "unknown"], "empty": ["string", "unknown"], "optlit": ["string | undefined", "unknown"],
         "nulllit": ["string | null", "unknown"], "str": ["unknown", "string | undefined", "string | number"], "num": ["unknown", "number | undefined", "number | string"], "int": ["number", "unknown", "number | undefined"],
         "optnum": ["unknown", "number | undefined | null"], "bool": ["unknown", "boolean | undefined", "boolean | number"], "yes": ["boolean | undefined", "unknown"], "big": ["unknown", "bigint | undefined"],
         "mixed": ["unknown", "string | number | boolean"], "color": ["string", "unknown"], "level": ["number", "unknown"]}
out = ['declare const console: { log(...values: unknown[]): void };', 'enum Color { Red = "red", Blue = "blue" }', 'enum Level { Low = 1, High = 2 }',
       'function show(value: unknown): string { return typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : String(value); }']
for name, ty, values, constants in FIELDS:
    out.append("interface H_%s { pad: string; held: %s }" % (name, ty))
    fs = []
    for w, wider in enumerate(WIDER[name]):
        for c, constant in enumerate(constants):
            uses = [("eq", "return g === %s;" % constant), ("qe", "return %s === g;" % constant), ("ne", "return g !== %s;" % constant), ("br", 'if (g === %s) return "yes"; return "no";' % constant),
                    ("tern", 'return `<${g === %s ? "yes" : "no"}>`;' % constant), ("loose", "return g == %s;" % constant), ("sw", 'switch (g) { case %s: return "hit"; default: return "miss"; }' % constant)]
            for u, body in uses:
                f = "f_%s_%d_%d_%s" % (name, w, c, u); fs.append(f)
                out.append("function %s(h: H_%s): unknown { const g: %s = h.held; %s }" % (f, name, wider, body))
        for u, body in [("type", "return typeof g;"), ("self", "return g === h.held;"), ("truth", 'return g ? "t" : "f";'), ("show", "return show(g);"), ("nullish", 'return g ?? "none";'), ("undef", "return g === undefined;"), ("null", "return g === null;"), ("two", "const k: %s = other.held; return g === k;" % wider)]:
            f = "f_%s_%d_%s" % (name, w, u); fs.append(f)
            out.append("function %s(h: H_%s, other: H_%s): unknown { const g: %s = h.held; %s }" % (f, name, name, wider, body))
    out.append("const all_%s: ((h: H_%s, other: H_%s) => unknown)[] = [%s];" % (name, name, name, ", ".join(fs)))
    out.append("const names_%s = %r;" % (name, fs))
    out.append("for (const held of [%s] as H_%s[\"held\"][]) all_%s.forEach((f, i) => console.log(names_%s[i], show(held), show(f({ pad: \"p\", held }, { pad: \"q\", held: %s }))));" % (", ".join(values), name, name, name, values[0]))
print("\n".join(out))
