#!/usr/bin/env python3
"""typed-programs.py <seed>: a random TypeScript program, written from a grammar that knows the types.

Interfaces, type aliases, classes with subclasses, accessors and private fields, discriminated unions, enums, tuples, arrays, maps, sets,
optional members, generic helpers, closures, generators and async functions are declared at random. Every expression is made for the type that
its place wants, so the program passes `strict` and no value is ever of another type than TypeScript says. Objects of the typed code are
handed to untyped code (`launder`), which does to them what JavaScript may do without breaking the type: extra, deleted and reordered
properties, accessors in place of data, frozen and sealed objects, another prototype in between, proxies, clones. Typed code then goes on
using what comes back. Each episode prints one line, `<label>: <what it saw>`, or `THROWS <name>` where an exception leaves it.
As plain Bun, line by line."""
import random, sys

seed = int(sys.argv[1]) if len(sys.argv) > 1 else 1
HOLES = len(sys.argv) > 2 and sys.argv[2] == "holes"
WORKERS = len(sys.argv) > 2 and sys.argv[2] == "workers"
R = random.Random(seed)

NUM, STR, BOOL = ("num",), ("str",), ("bool",)
FIELD_NAMES = ["a", "b", "c", "id", "name", "count", "label", "items", "value", "x", "y", "flag", "note", "size", "total", "key", "left", "right", "tag", "data"]
NUMBERS = ["0", "1", "2", "3", "7", "-1", "0.5", "-0", "1.5", "255", "256", "65535", "65536", "2147483647", "-2147483648", "2147483648", "4294967295", "4294967296", "1e21", "1e-7", "9007199254740991", "Number.NaN", "(0 / 0)", "Infinity", "-Infinity", "1073741823", "1073741824", "-1073741825", "0.1", "100", "1000003"]
SMALL = ["0", "1", "2", "3", "4", "5", "7", "10"]
STRINGS = ['""', '"a"', '"b"', '"ab"', '"hello"', '"\\u4e16"', '"\\u4e16a"', '"\\ud83d\\ude00"', '"12"', '"-0"', '"1e3"', '" "', '"length"', '"__proto__"', '"constructor"', '"a,b"', '"\\n"', '"\\0"', '"Z"', '"\\u00e9"']

records = {}      # name -> dict(kind, fields, base, methods, ctor)
unions = {}       # name -> [record names], told apart by `kind`
enums = {}        # name -> (is_string, [members])
functions = []    # (name, params, ret, is_async, is_generator)
defaulted = set() # the functions whose last parameter has a default
out = []
counter = [0]


def fresh(prefix):
    counter[0] += 1
    return "%s%d" % (prefix, counter[0])


def chance(p):
    return R.random() < p


def ts(t):
    k = t[0]
    if k == "num": return "number"
    if k == "str": return "string"
    if k == "bool": return "boolean"
    if k == "lit": return " | ".join(t[1])
    if k == "arr": return ("(%s)[]" if t[1][0] in ("opt", "nul", "lit", "fn") else "%s[]") % ts(t[1])
    if k == "tup": return "[" + ", ".join(ts(x) for x in t[1]) + "]"
    if k in ("rec", "union", "enum"): return t[1]
    if k == "opt": return ("(%s) | undefined" if t[1][0] == "fn" else "%s | undefined") % ts(t[1])
    if k == "nul": return ("(%s) | null" if t[1][0] == "fn" else "%s | null") % ts(t[1])
    if k == "fn": return "(" + ", ".join("p%d: %s" % (i, ts(p)) for i, p in enumerate(t[1])) + ") => " + ts(t[2])
    if k == "map": return "Map<%s, %s>" % (ts(t[1]), ts(t[2]))
    if k == "set": return "Set<%s>" % ts(t[1])
    if k == "box": return "Box<%s>" % ts(t[1])
    if k == "dict": return "Record<string, %s>" % ts(t[1])
    raise Exception(t)


def random_type(depth=2, allow_records=True):
    choices = [NUM] * 5 + [STR] * 4 + [BOOL] * 2
    if depth > 0:
        choices += [("arr",), ("arr",), ("opt",), ("tup",), ("nul",), ("map",), ("set",), ("lit",), ("fn",), ("box",), ("dict",), ("dict",)]
        if allow_records and records: choices += [("rec",)] * 5
        if allow_records and unions: choices += [("union",)] * 2
        if enums: choices += [("enum",)]
    t = R.choice(choices)
    k = t[0]
    if k == "arr": return ("arr", random_type(depth - 1, allow_records))
    if k in ("opt", "nul"):
        inner = random_type(depth - 1, allow_records)
        return inner if inner[0] in ("opt", "nul") else (k, inner)
    if k == "tup": return ("tup", tuple(random_type(depth - 1, allow_records) for _ in range(R.randint(2, 3))))
    if k == "map": return ("map", R.choice([NUM, STR]), random_type(depth - 1, allow_records))
    if k == "set": return ("set", R.choice([NUM, STR]))
    if k == "lit": return ("lit", tuple(R.sample(['"on"', '"off"', '"idle"', '"done"'], R.randint(2, 3)))) if chance(0.6) else ("lit", tuple(R.sample(["0", "1", "2", "3", "10", "-1"], R.randint(2, 3))))
    if k == "fn": return ("fn", tuple(R.choice([NUM, STR, BOOL]) for _ in range(R.randint(0, 2))), R.choice([NUM, STR, BOOL]))
    if k == "box": return ("box", random_type(depth - 1, allow_records))
    if k == "dict": return ("dict", R.choice([NUM, STR, BOOL, random_type(depth - 1, allow_records)]))
    if k == "rec": return ("rec", R.choice(list(records)))
    if k == "union": return ("union", R.choice(list(unions)))
    if k == "enum": return ("enum", R.choice(list(enums)))
    return t


def all_fields(name):
    r = records[name]
    return (all_fields(r["base"]) if r["base"] else []) + r["fields"]


def is_subclass(name, of):
    while name:
        if name == of: return True
        name = records[name]["base"]
    return False


# ---------------------------------------------------------------- scopes

class Scope:
    def __init__(self, parent=None):
        self.parent, self.names = parent, []

    def add(self, name, t, mutable=False):
        self.names.append((name, t, mutable))

    def all(self):
        own = {n for n, _, _ in self.names}
        return [x for x in (self.parent.all() if self.parent else []) if x[0] not in own] + self.names

    def of(self, t, mutable=False):
        return [n for n, u, m in self.all() if u == t and (m or not mutable)]

    def where(self, test):
        return [(n, u, m) for n, u, m in self.all() if test(u)]


# ---------------------------------------------------------------- values made anew

KEYS = ["a", "b", "c", "key", "0", "1", "2", "7", "10", "-1", "01", "1.5", "4294967294", "4294967295", "1e3", "constructor", "length", "toString", "valueOf", "", "a b", "\\u4e16", "name", "NaN", "Infinity", "-0"]


def key_text():
    return '"%s"' % R.choice(KEYS)


INHERITED = ("constructor", "toString", "valueOf")   # TypeScript takes these for the members of Object, not for the index signature


def literal_keys(n):
    return [literal_key(k) for k in R.sample([k for k in KEYS if k not in INHERITED], n)]


def literal_key(k=None):
    """A key as it is written in an object literal."""
    if k is None: k = R.choice([k for k in KEYS if k not in INHERITED])
    forms = ['"%s"' % k, '["%s"]' % k]
    if k.isidentifier(): forms += [k] * 2
    if k.isdigit() and (k == "0" or not k.startswith("0")): forms += [k, "[%s]" % k] * 2
    if k in ("1.5", "1e3"): forms += [k, "[%s]" % k]
    return R.choice(forms)


def number_literal():
    n = R.choice(NUMBERS if chance(0.5) else SMALL)
    return "(%s)" % n if n.startswith("-") else n


def make(t, depth=2):
    k = t[0]
    if k == "num": return number_literal()
    if k == "str":
        if chance(0.15): return R.choice(['"ab".repeat(%d)' % R.choice([2, 9, 40]), '("x" + String(%s))' % R.choice(SMALL), '"abcdefghij".slice(%d, %d)' % (R.randint(0, 3), R.randint(4, 9)), '"\\u4e16bcdef".slice(1)', "String.fromCharCode(%d)" % R.choice([65, 233, 19990]), "`t${%s}`" % R.choice(SMALL)])
        return R.choice(STRINGS)
    if k == "bool": return R.choice(["true", "false"])
    if k == "lit": return "of<%s>(%s)" % (ts(t), R.choice(t[1]))
    if k == "arr":
        if depth <= 0: return "[]"
        return "[" + ", ".join(make(t[1], depth - 1) for _ in range(R.choice([0, 1, 2, 3, 3, 5]))) + "]"
    if k == "tup": return "[" + ", ".join(make(x, depth - 1) for x in t[1]) + "]"
    if k == "opt": return "of<%s>(%s)" % (ts(t), "undefined" if chance(0.35) or depth <= 0 else make(t[1], depth - 1))
    if k == "nul": return "of<%s>(%s)" % (ts(t), "null" if chance(0.35) or depth <= 0 else make(t[1], depth - 1))
    if k == "fn":
        params = ", ".join("p%d: %s" % (i, ts(p)) for i, p in enumerate(t[1]))
        scope = Scope()
        for i, p in enumerate(t[1]): scope.add("p%d" % i, p)
        return "((%s): %s => (%s))" % (params, ts(t[2]), expr(t[2], scope, 1))
    if k == "map":
        n = 0 if depth <= 0 else R.randint(0, 3)
        return "new Map<%s, %s>([%s])" % (ts(t[1]), ts(t[2]), ", ".join("[%s, %s]" % (make(t[1], 0), make(t[2], depth - 1)) for _ in range(n)))
    if k == "set": return "new Set<%s>([%s])" % (ts(t[1]), ", ".join(make(t[1], 0) for _ in range(R.randint(0, 3))))
    if k == "box": return "new Box<%s>(%s)" % (ts(t[1]), make(t[1], depth - 1))
    if k == "dict": return "{ " + ", ".join("%s: %s" % (key, make(t[1], depth - 1)) for key in literal_keys(0 if depth <= 0 else R.randint(0, 4))) + " }"
    if k == "enum": return "of<%s>(%s.%s)" % (t[1], t[1], R.choice(enums[t[1]][1]))
    if k == "union": return "of<%s>(%s)" % (t[1], make(("rec", R.choice(unions[t[1]])), depth))
    if k == "rec": return make_record(t[1], depth)
    raise Exception(t)


def make_record(name, depth):
    r = records[name]
    if r["kind"] == "class":
        heirs = [n for n in records if records[n]["kind"] == "class" and is_subclass(n, name)]
        name = R.choice(heirs) if chance(0.3) else name
        r = records[name]
        return "new %s(%s)" % (name, ", ".join(make(t, depth - 1) for _, t in constructor_parameters(name)))
    fields = []
    for f, t, optional, _ in all_fields(name):
        if f == "kind" and t[0] == "lit": fields.append("kind: %s" % t[1][0])
        elif optional and (chance(0.5) or depth <= 0): continue
        else: fields.append("%s: %s" % (f, make(t, depth - 1)))
    if chance(0.3): R.shuffle(fields)
    return "{ " + ", ".join(fields) + " }" if fields else "{}"


def constructor_parameters(name):
    r = records[name]
    return (constructor_parameters(r["base"]) if r["base"] else []) + r["ctor"]


# ---------------------------------------------------------------- expressions

def pick_variable(t, scope):
    found = scope.of(t)
    if t[0] == "rec" and records[t[1]]["kind"] == "class":
        found += [n for n, u, _ in scope.all() if u[0] == "rec" and u[1] != t[1] and records[u[1]]["kind"] == "class" and is_subclass(u[1], t[1])]
    if t[0] == "union":
        found += [n for n, u, _ in scope.all() if u[0] == "rec" and u[1] in unions[t[1]]]
    return R.choice(found) if found else None


def field_read(t, scope):
    """An expression that reads a member of type t from a record in scope."""
    found = []
    for n, u, _ in scope.all():
        if u[0] == "rec":
            for f, ft, optional, _ in all_fields(u[1]):
                if ft == t and not optional: found.append("%s.%s" % (n, f))
                if optional and ("opt", ft) == t: found.append("%s.%s" % (n, f))
            for m in methods_of(u[1]):
                if m["ret"] == t and m["kind"] == "getter": found.append("%s.%s" % (n, m["name"]))
        if u[0] == "tup":
            found += ["%s[%d]" % (n, i) for i, x in enumerate(u[1]) if x == t]
        if u[0] == "box" and u[1] == t: found += ["%s.value" % n, "%s.get()" % n]
        if u[0] in ("opt", "nul") and u[1][0] == "rec" and t[0] not in ("opt", "nul"):
            for f, ft, optional, _ in all_fields(u[1][1]):
                if ft == t: found += ["(%s?.%s ?? %s)" % (n, f, make(t, 1))] * 2
            for m in methods_of(u[1][1]):
                if m["ret"] == t and m["kind"] == "method" and not m["params"]: found.append("(%s?.%s() ?? %s)" % (n, m["name"], make(t, 1)))
    return R.choice(found) if found else None


def methods_of(name):
    r = records[name]
    return (methods_of(r["base"]) if r["base"] else []) + r["methods"]


def call(t, scope, depth):
    found = [f for f in functions if f[2] == t and not f[3] and not f[4]]
    calls = []
    if found:
        name, params, _, _, _ = R.choice(found)
        given = params[:-1] if name in defaulted and chance(0.5) else params
        calls.append(lambda: "%s(%s)" % (name, ", ".join(expr(p, scope, depth - 1) for p in given)))
    for n, u, _ in scope.all():
        if u[0] == "rec":
            for m in methods_of(u[1]):
                if m["ret"] == t and m["kind"] == "method":
                    calls.append(lambda n=n, m=m: "%s.%s(%s)" % (n, m["name"], ", ".join(expr(p, scope, depth - 1) for p in m["params"])))
        if u[0] == "fn" and u[2] == t:
            calls.append(lambda n=n, u=u: "%s(%s)" % (n, ", ".join(expr(p, scope, depth - 1) for p in u[1])))
    return R.choice(calls)() if calls else None


def container_read(t, scope, depth):
    found = []
    for n, u, _ in scope.all():
        if u == ("arr", t):
            i = R.choice(SMALL)
            found.append("(%s.length > %s ? %s[%s] : %s)" % (n, i, n, i, "@"))
            found.append("(%s.at(%s) ?? @)" % (n, R.choice(["0", "-1", "1", "5"])) if t[0] not in ("opt", "nul") else "(%s.length > 0 ? %s[0] : @)" % (n, n))
            if HOLES: found.append("%s[%s]" % (n, R.choice(SMALL)))
        if u[0] == "map" and u[2] == t and t[0] not in ("opt", "nul"):
            found.append("(%s.get(%s) ?? @)" % (n, make(u[1], 0)))
        if u == ("dict", t):
            key = key_text()
            found += ["(Object.hasOwn(%s, %s) ? %s[%s] : @)" % (n, key, n, key)] * 2
            if HOLES: found.append("%s[%s]" % (n, key))
    if not found: return None
    return R.choice(found).replace("@", expr(t, scope, depth - 1))


# --aot refuses these on purpose, with a TypeError: another prototype for an object of a declared type (8, 23), a required property deleted (11),
# a declared property redefined as an accessor, as not enumerable or as not writable (6, 7, 15, 16).
# For arrays: a proxy in place of the array (3), an accessor in place of an element (6).
AGAINST_THE_RULES = (6, 7, 8, 11, 15, 16, 23)


def launder(e, t):
    """Hands a value to untyped code and takes it back as the same type."""
    k = t[0]
    if k == "rec":
        r = records[t[1]]
        ways = list(range(0, 19))
        if r["kind"] != "class": ways += [19, 20] + ([21] if json_safe(t) else [])
        else: ways += [22, 23]
        if not HOLES: ways = [w for w in ways if w not in AGAINST_THE_RULES]
        return "launder<%s>(%s, %d)" % (ts(t), e, R.choice(ways))
    if k == "arr": return "launderArray<%s>(%s, %d)" % (ts(t[1]), e, R.choice([w for w in range(10) if HOLES or w not in (3, 6)]))
    return e


def json_safe(t, seen=()):
    k = t[0]
    if k in ("num", "str", "bool", "lit", "enum"): return k != "num"
    if k in ("arr", "nul"): return json_safe(t[1], seen)
    if k == "tup": return all(json_safe(x, seen) for x in t[1])
    if k == "rec":
        if t[1] in seen or records[t[1]]["kind"] == "class": return False
        return all(json_safe(ft, seen + (t[1],)) for _, ft, _, _ in all_fields(t[1]))
    return False


def wide(e, t):
    """Keeps TypeScript from comparing two literal types, which it rejects."""
    return R.choice(["of<%s>(%s)", "(%s_ as %s)"]).replace("%s_ as %s", "%s as %s" ) % ((ts(t), e) if False else (ts(t), e)) if False else ("of<%s>(%s)" % (ts(t), e) if chance(0.5) else "(%s as %s)" % (e, ts(t)))


def integer(scope, depth):
    e = expr(NUM, scope, depth)
    return R.choice(["(%s | 0)", "(%s >>> 0)", "Math.trunc(%s)", "(%s & 255)", "(%s %% 7)", "Math.floor(%s)", "(~~%s)"]) % e


def expr(t, scope, depth):
    k = t[0]
    if depth <= 0 or chance(0.12):
        return pick_variable(t, scope) or make(t, 1 if depth > 0 else 0)
    ways = []
    v = pick_variable(t, scope)
    if v: ways += [lambda: v] * 4
    ways += [lambda: field_read(t, scope)] * 3 + [lambda: call(t, scope, depth)] * 3 + [lambda: container_read(t, scope, depth)] * 2
    ways += [lambda: make(t, min(depth, 2))]
    ways += [lambda: "(%s ? %s : %s)" % (expr(BOOL, scope, depth - 1), expr(t, scope, depth - 1), expr(t, scope, depth - 1))]
    e1 = lambda u=t: expr(u, scope, depth - 1)
    if k == "num":
        ways += [lambda: "(%s %s %s)" % (e1(), R.choice(["+", "-", "*", "/", "%", "+", "-", "*"]), e1())] * 5
        ways += [lambda: "(%s %s %s)" % (e1(), R.choice(["|", "&", "^", ">>", ">>>"]), e1())] * 2
        ways += [lambda: "(%s << %s)" % (e1(), pick_variable(NUM, scope) or R.choice(SMALL + ["31", "32", "33"]))]
        ways += [lambda: integer(scope, depth - 1)] * 2
        ways += [lambda: "Math.%s(%s)" % (R.choice(["abs", "floor", "ceil", "round", "trunc", "sign", "sqrt", "fround", "clz32", "cbrt"]), e1())]
        ways += [lambda: "Math.%s(%s, %s)" % (R.choice(["max", "min", "imul", "pow", "atan2", "hypot"]), e1(), e1())]
        ways += [lambda: "(-%s)" % e1(), lambda: "(+%s)" % e1(BOOL), lambda: "%s.length" % e1(STR), lambda: "Number(%s)" % e1(STR), lambda: "parseInt(%s, %s)" % (e1(STR), R.choice(["10", "16", "2", "36"])), lambda: "parseFloat(%s)" % e1(STR)]
        ways += [lambda: "%s.charCodeAt(%s)" % (e1(STR), R.choice(SMALL)), lambda: "%s.indexOf(%s)" % (e1(STR), e1(STR)), lambda: "(%s.codePointAt(0) ?? -1)" % e1(STR)]
        arrays = scope.where(lambda u: u[0] in ("arr", "map", "set"))
        if arrays: ways += [lambda: (lambda a: "%s.%s" % (a[0], "length" if a[1][0] == "arr" else "size"))(R.choice(arrays))] * 2
        numbers = scope.of(("arr", NUM))
        if numbers: ways += [lambda: "%s.reduce((sum: number, each: number): number => sum + each, %s)" % (R.choice(numbers), e1()), lambda: "%s.indexOf(%s)" % (R.choice(numbers), e1())]
        mutable = scope.of(NUM, True)
        if mutable: ways += [lambda: "(%s %s %s)" % (R.choice(mutable), R.choice(["+=", "-=", "*=", "|=", "="]), e1()), lambda: R.choice(["%s++", "++%s", "%s--", "--%s"]) % R.choice(mutable)]
        if enums:
            numeric = [n for n in enums if not enums[n][0]]
            if numeric: ways += [lambda: "(%s + 0)" % e1(("enum", R.choice(numeric)))]
    elif k == "str":
        ways += [lambda: "(%s + %s)" % (e1(), e1())] * 4 + [lambda: "(%s + %s)" % (e1(), e1(NUM)), lambda: "(%s + %s)" % (e1(NUM), e1()), lambda: "`${%s}|${%s}`" % (e1(R.choice([NUM, STR, BOOL])), e1(R.choice([NUM, STR, BOOL])))] * 2
        ways += [lambda: "String(%s)" % e1(R.choice([NUM, BOOL])), lambda: "%s.toString(%s)" % (integer(scope, depth - 1), R.choice(["2", "8", "16", "36", "10"])), lambda: "(%s).toFixed(%s)" % (e1(NUM), R.choice(["0", "1", "2", "5"]))]
        ways += [lambda: "%s.%s()" % (e1(), R.choice(["toUpperCase", "toLowerCase", "trim", "normalize"])), lambda: "%s.slice(%s, %s)" % (e1(), R.choice(SMALL + ["-1", "-2"]), R.choice(SMALL + ["-1", "100"])), lambda: "%s.substring(%s)" % (e1(), R.choice(SMALL)), lambda: "%s.charAt(%s)" % (e1(), R.choice(SMALL)), lambda: "%s.repeat(%s)" % (e1(), R.choice(["0", "1", "2", "3"])), lambda: "%s.padStart(%s, %s)" % (e1(), R.choice(SMALL), e1()), lambda: "%s.replace(%s, %s)" % (e1(), e1(), e1()), lambda: "%s.split(%s).join(%s)" % (e1(), e1(), e1()), lambda: "(%s.at(%s) ?? \"none\")" % (e1(), R.choice(["0", "-1", "3"])), lambda: "%s.concat(%s)" % (e1(), e1())]
        ways += [lambda: "(typeof %s)" % e1(random_type(1)), lambda: "JSON.stringify(%s)" % e1(R.choice([NUM, STR, BOOL]))]
        texts = scope.of(("arr", STR))
        if texts: ways += [lambda: "%s.join(%s)" % (R.choice(texts), e1())]
        mutable = scope.of(STR, True)
        if mutable: ways += [lambda: (lambda m: "(%s = clip(%s + %s))" % (m, m, e1()))(R.choice(mutable))]
    elif k == "bool":
        ways += [lambda: "(%s %s %s)" % (wide(e1(NUM), NUM), R.choice(["<", "<=", ">", ">=", "===", "!=="]), e1(NUM))] * 5
        ways += [lambda: "(%s %s %s)" % (wide(e1(STR), STR), R.choice(["<", "<=", ">", ">=", "===", "!=="]), e1(STR))] * 3
        ways += [lambda: "(%s %s %s)" % (e1(), R.choice(["&&", "||"]), e1()), lambda: "(!%s)" % e1(), lambda: "Number.isInteger(%s)" % e1(NUM), lambda: "Number.isNaN(%s)" % e1(NUM), lambda: "Object.is(%s, %s)" % (e1(NUM), e1(NUM)), lambda: "Number.isSafeInteger(%s)" % e1(NUM), lambda: "Boolean(%s)" % e1(R.choice([NUM, STR]))]
        ways += [lambda: "%s.%s(%s)" % (e1(STR), R.choice(["includes", "startsWith", "endsWith"]), e1(STR))]
        recs = scope.where(lambda u: u[0] == "rec")
        if recs:
            ways += [lambda: "((%s as string) in %s)" % (R.choice(['"%s"' % f for f in FIELD_NAMES[:8]]), R.choice(recs)[0]), lambda: "Object.isFrozen(%s)" % R.choice(recs)[0], lambda: "Object.hasOwn(%s, %s)" % (R.choice(recs)[0], R.choice(['"%s"' % f for f in FIELD_NAMES[:8]]))]
            classes = [n for n in records if records[n]["kind"] == "class"]
            if classes: ways += [lambda: "((%s as object) instanceof %s)" % (R.choice(recs)[0], R.choice(classes))]
            same = [(a, b) for a, u, _ in recs for b, w, _ in recs if u == w]
            ways += [lambda: "(%s === %s)" % R.choice(same)]
        options = scope.where(lambda u: u[0] in ("opt", "nul"))
        if options: ways += [lambda: (lambda o: "(%s %s %s)" % (o[0], R.choice(["===", "!=="]), "undefined" if o[1][0] == "opt" else "null"))(R.choice(options))] * 2
        sets = scope.where(lambda u: u[0] in ("set", "map"))
        if sets: ways += [lambda: (lambda s: "%s.has(%s)" % (s[0], e1(s[1][1])))(R.choice(sets))]
        dicts = scope.where(lambda u: u[0] == "dict")
        if dicts: ways += [lambda: "(%s in %s)" % (key_text(), R.choice(dicts)[0]), lambda: "Object.hasOwn(%s, %s)" % (R.choice(dicts)[0], key_text()), lambda: "(%s in %s)" % (R.choice(SMALL), R.choice(dicts)[0])]
    elif k == "arr":
        same = scope.of(t)
        if same:
            a = R.choice(same)
            ways += [lambda: "%s.slice(%s)" % (a, R.choice(["", "1", "-1", "0, 2"])), lambda: "[...%s, ...%s]" % (a, R.choice(same)), lambda: "%s.concat(%s)" % (a, e1()), lambda: "%s.filter((each: %s, index: number): boolean => index %% 2 === %s)" % (a, ts(t[1]), R.choice("01")), lambda: "[...%s].reverse()" % a, lambda: "Array.from(%s)" % a, lambda: "%s.map((each: %s): %s => each)" % (a, ts(t[1]), ts(t[1]))]
        ways += [lambda: "[%s, %s]" % (e1(t[1]), e1(t[1])), lambda: launder(e1(), t)] * 2
        others = scope.where(lambda u: u[0] == "arr")
        if others:
            ways += [lambda: (lambda o: "%s.map((each: %s): %s => (%s))" % (o[0], ts(o[1][1]), ts(t[1]), expr(t[1], with_name(scope, "each", o[1][1]), depth - 1)))(R.choice(others))] * 2
        if t[1] == STR: ways += [lambda: "%s.split(%s)" % (e1(STR), e1(STR)), lambda: "[...%s]" % e1(STR)]
        recs = scope.where(lambda u: u[0] == "rec")
        if t[1] == STR and recs: ways += [lambda: "Object.keys(%s)" % R.choice(recs)[0]] * 2
        dicts = scope.where(lambda u: u[0] == "dict")
        if t[1] == STR and dicts: ways += [lambda: "Object.keys(%s)" % R.choice(dicts)[0]] * 3 + [lambda: "Object.getOwnPropertyNames(%s)" % R.choice(dicts)[0]]
        valued = scope.of(("dict", t[1]))
        if valued: ways += [lambda: "Object.values(%s)" % R.choice(valued)] * 2
        if t[1] == NUM: ways += [lambda: "Array.from({ length: %s }, (_: unknown, index: number): number => index * %s)" % (R.choice(SMALL), e1(NUM))]
        maps = scope.where(lambda u: u[0] == "map" and u[2] == t[1])
        if maps: ways += [lambda: "[...%s.values()]" % R.choice(maps)[0]]
        sets = scope.where(lambda u: u[0] == "set" and u[1] == t[1])
        if sets: ways += [lambda: "[...%s]" % R.choice(sets)[0]]
    elif k == "rec":
        r = records[t[1]]
        ways += [lambda: launder(e1(), t)] * 4
        if r["kind"] != "class":
            spreadable = scope.of(t)
            writable = [(f, ft) for f, ft, _, _ in all_fields(t[1]) if f != "kind"]
            if spreadable: ways += [lambda: "{ ...%s }" % R.choice(spreadable)] + ([lambda: (lambda f: "{ ...%s, %s: %s }" % (R.choice(spreadable), f[0], e1(f[1])))(R.choice(writable))] * 2 if writable else [])
    elif k == "opt":
        ways += [lambda: "of<%s>(%s)" % (ts(t), e1(t[1]))] * 2
        for n, u, _ in scope.all():
            if u == ("arr", t[1]): ways += [lambda n=n: "%s.at(%s)" % (n, R.choice(["0", "-1", "2", "9"])), lambda n=n: "%s.find((each: %s): boolean => %s)" % (n, ts(t[1]), expr(BOOL, with_name(scope, "each", t[1]), depth - 1))]
            if u[0] == "map" and u[2] == t[1]: ways += [lambda n=n, u=u: "%s.get(%s)" % (n, e1(u[1]))]
    elif k == "nul":
        ways += [lambda: "of<%s>(%s)" % (ts(t), e1(t[1]))] * 2
    elif k == "tup":
        ways += [lambda: "of<%s>([%s])" % (ts(t), ", ".join(e1(x) for x in t[1]))] * 3
    elif k == "dict":
        same = scope.of(t)
        if same:
            ways += [lambda: "{ ...%s, %s: %s }" % (R.choice(same), literal_key(), e1(t[1]))] * 4
            ways += [lambda: (lambda keys: "{ ...%s, %s: %s, %s: %s }" % (R.choice(same), keys[0], e1(t[1]), keys[1], e1(t[1])))(literal_keys(2)), lambda: "{ %s: %s, ...%s }" % (literal_key(), e1(t[1]), R.choice(same)), lambda: "{ ...%s, ...%s }" % (R.choice(same), R.choice(same)), lambda: "Object.assign({}, %s)" % R.choice(same), lambda: "Object.fromEntries(Object.entries(%s))" % R.choice(same), lambda: "{ ...%s, [%s]: %s }" % (R.choice(same), e1(STR), e1(t[1])), lambda: "{ ...%s, [%s]: %s }" % (R.choice(same), e1(NUM), e1(t[1]))]
        ways += [lambda: "{ [String(%s)]: %s, %s: %s }" % (e1(R.choice([STR, NUM])), e1(t[1]), literal_key(), e1(t[1]))]
    elif k == "box":
        ways += [lambda: "new Box<%s>(%s)" % (ts(t[1]), e1(t[1]))] * 2
        same = scope.of(t)
        if same: ways += [lambda: "%s.with(%s)" % (R.choice(same), e1(t[1]))]
    for _ in range(6):
        made = R.choice(ways)()
        if made: return made
    return make(t, 1)


def with_name(scope, name, t, mutable=False):
    inner = Scope(scope)
    inner.add(name, t, mutable)
    return inner


# ---------------------------------------------------------------- how a value is shown by typed code

def show(e, t, depth=2):
    """An expression of type string that tells what the value is, by typed reads alone."""
    k = t[0]
    if k == "num": return "num(%s)" % e
    if k == "str": return "JSON.stringify(%s)" % e
    if k in ("bool", "lit", "enum"): return "String(%s)" % e
    if k in ("rec", "union"): return "show%s(%s)" % (t[1], e) if depth > 0 else '"."'
    if k == "opt": return "((v: %s): string => v === undefined ? \"undefined\" : %s)(%s)" % (ts(t), show("v", t[1], depth), e)
    if k == "nul": return "((v: %s): string => v === null ? \"null\" : %s)(%s)" % (ts(t), show("v", t[1], depth), e)
    if k == "arr": return "(\"[\" + %s.map((v: %s): string => %s).join(\",\") + \"]\")" % (e, ts(t[1]), show("v", t[1], depth - 1))
    if k == "tup": return "((v: %s): string => \"<\" + %s + \">\")(%s)" % (ts(t), ' + "," + '.join(show("v[%d]" % i, x, depth - 1) for i, x in enumerate(t[1])), e)
    if k == "fn": return "(\"fn/\" + %s.length)" % e
    if k == "map": return "(\"Map{\" + [...%s].map(([k, v]: [%s, %s]): string => %s + \"=>\" + %s).join(\",\") + \"}\")" % (e, ts(t[1]), ts(t[2]), show("k", t[1], 0), show("v", t[2], depth - 1))
    if k == "set": return "(\"Set{\" + [...%s].map((v: %s): string => %s).join(\",\") + \"}\")" % (e, ts(t[1]), show("v", t[1], 0))
    if k == "box": return "(\"Box(\" + %s + \")\")" % show("%s.value" % e, t[1], depth - 1)
    if k == "dict": return "(\"{\" + Object.entries(%s).map(([k, v]: [string, %s]): string => k + \":\" + %s).join(\",\") + \"}\")" % (e, ts(t[1]), show("v", t[1], depth - 1))
    raise Exception(t)


def tell(e, t):
    return show(e, t) if chance(0.6) else "inspect(%s)" % e


# ---------------------------------------------------------------- statements

def block(scope, n, depth, ret, indent, in_loop=False, log="seen"):
    lines = []
    scope = Scope(scope)
    for _ in range(n):
        lines += statement(scope, depth, ret, indent, in_loop, log)
    return lines


def statement(scope, depth, ret, indent, in_loop, log):
    pad = "  " * indent
    ways = ["declare"] * 6 + ["log"] * 4 + ["store"] * 5 + ["assign"] * 3
    if depth > 0: ways += ["if"] * 3 + ["for", "for", "forof", "forof", "try", "try", "switch", "forin", "destructure", "closure", "while", "collection", "collection", "delete", "labeled"]
    if depth > 0: ways += ["logical", "logical", "later", "pattern", "walk", "regexp", "spreadcall"]
    if HOLES: ways += ["hole"] * 8
    if in_loop: ways += ["break", "continue"]
    if ret is not None and depth > 0: ways += ["return"]
    w = R.choice(ways)
    if w == "hole":
        return hole(scope, pad, log)
    if w == "logical":
        found = [(n, u) for n, u, m in scope.all() if m and u[0] in ("opt", "nul", "bool", "num", "str")]
        found += [("%s.%s" % (n, f), ("opt", ft)) for n, u, _ in scope.all() if u[0] == "rec" for f, ft, optional, readonly in all_fields(u[1]) if optional and not readonly and ft[0] != "opt"]
        if not found: return []
        n, u = R.choice(found)
        inner = u[1] if u[0] in ("opt", "nul") else u
        return ["%s%s %s %s;" % (pad, n, "??=" if u[0] in ("opt", "nul") else R.choice(["||=", "&&="]), expr(inner, scope, 2))]
    if w == "later":
        t = R.choice([NUM, STR])
        made, i = fresh("made"), fresh("i")
        inner = with_name(scope, i, NUM)
        return ["%sconst %s: (() => %s)[] = [];" % (pad, made, ts(t)), "%sfor (let %s = 0; %s < %s; %s++) %s.push((): %s => %s);" % (pad, i, i, R.choice("234"), i, made, ts(t), expr(t, inner, 2)), "%s%s.push(%s.map((each: () => %s): string => String(each())).join(\"/\"));" % (pad, log, made, ts(t))]
    if w == "pattern":
        found = scope.where(lambda u: u[0] == "rec" and any(f[2] for f in all_fields(u[1])))
        if not found: return []
        n, u, _ = R.choice(found)
        f, ft, _, _ = R.choice([f for f in all_fields(u[1]) if f[2]])
        if ft[0] in ("opt", "nul"): return []
        name = fresh("d")
        scope.add(name, ft)
        return ["%sconst { %s: %s = %s } = %s;" % (pad, f, name, make(ft, 1), n)]
    if w == "walk":
        found = scope.where(lambda u: u[0] == "rec" and any(f[0] == "next" for f in all_fields(u[1])))
        if not found: return []
        n, u, _ = R.choice(found)
        at, steps = fresh("at"), fresh("steps")
        return ["%slet %s = 0;" % (pad, steps), "%sfor (let %s: %s | undefined = %s; %s !== undefined && %s < 5; %s = %s.next) %s++;" % (pad, at, u[1], n, at, steps, at, at, steps), "%s%s.push(\"steps \" + %s);" % (pad, log, steps)]
    if w == "regexp":
        s = expr(STR, scope, 1)
        return [pad + "%s.push(%s);" % (log, R.choice(["String(/\\d+/.test(%s))", "(%s.match(/(a)(b)?/)?.[2] ?? \"none\")", "%s.replace(/[a-c]/g, (found: string): string => found.toUpperCase())", "String(%s.search(/[0-9]/))", "%s.split(/,|b/).join(\"|\")", "[...%s.matchAll(/./gu)].length.toString()", "(/(?<first>.)/u.exec(%s)?.groups?.first ?? \"none\")"]) % s)]
    if w == "spreadcall":
        numbers = scope.of(("arr", NUM))
        if not numbers: return []
        return [pad + "%s.push(num(%s));" % (log, R.choice(["Math.max(...%s)", "Math.min(0, ...%s)", "total(...%s)", "total(1, ...%s, 2)", "Math.hypot(...%s.slice(0, 2))"]) % R.choice(numbers))]
    if w == "declare":
        t = random_type(2)
        name = fresh("v")
        mutable = chance(0.4)
        line = "%s%s %s: %s = %s;" % (pad, "let" if mutable else "const", name, ts(t), unnarrowed(expr(t, scope, 2), t))
        scope.add(name, t, mutable)
        return [line]
    if w == "log":
        found = scope.all()
        if not found: return []
        n, t, _ = R.choice(found)
        return ["%s%s.push(%s);" % (pad, log, tell(n, t))]
    if w == "store":
        found = []
        for n, u, _ in scope.all():
            if u[0] == "rec":
                found += [("%s.%s" % (n, f), ("opt", ft) if optional and ft[0] != "opt" else ft) for f, ft, optional, readonly in all_fields(u[1]) if not readonly and f != "kind"]
                found += [("%s.%s" % (n, m["name"]), m["ret"]) for m in methods_of(u[1]) if m["kind"] == "getter" and m["setter"]]
            if u[0] == "box": found.append(("%s.value" % n, u[1]))
            if u[0] == "tup": found += [("%s[%d]" % (n, i), x) for i, x in enumerate(u[1])]
            if u[0] == "arr": found += [("%s[%s]" % (n, R.choice(["0", "1", "%s.length" % n])), u[1])]
            if u[0] == "dict": found += [("%s[%s]" % (n, key_text()), u[1])] * 2 + [("%s[%s]" % (n, R.choice(SMALL)), u[1])]
        if not found: return []
        target, t = R.choice(found)
        reads_inherited = not HOLES and any('["%s"]' % k in target for k in ("constructor", "toString", "valueOf"))
        if reads_inherited: return ["%s%s = %s;" % (pad, target, expr(t, scope, 2))]
        if t == NUM and chance(0.4): return ["%s%s %s %s;" % (pad, target, R.choice(["+=", "-=", "*=", "|=", ">>>=", "%=", "**="]), expr(NUM, scope, 1))] if chance(0.7) else ["%s%s%s;" % (pad, target, R.choice(["++", "--"]))]
        if t == STR and chance(0.3): return ["%s%s = clip(%s + %s);" % (pad, target, target, expr(STR, scope, 1))]
        return ["%s%s = %s;" % (pad, target, expr(t, scope, 2))]
    if w == "assign":
        found = [(n, u) for n, u, m in scope.all() if m]
        if not found: return []
        n, t = R.choice(found)
        return ["%s%s = %s;" % (pad, n, unnarrowed(expr(t, scope, 2), t))]
    if w == "if":
        lines = ["%sif (%s) {" % (pad, expr(BOOL, scope, 2))] + block(scope, R.randint(1, 3), depth - 1, ret, indent + 1, in_loop, log)
        if chance(0.5): lines += ["%s} else {" % pad] + block(scope, R.randint(1, 3), depth - 1, ret, indent + 1, in_loop, log)
        return lines + [pad + "}"]
    if w == "for":
        i = fresh("i")
        first, last, step = R.choice([("0", R.choice(SMALL), "++"), (R.choice(SMALL), "0", "--"), ("2147483645", "2147483650", "++"), ("-2", "3", "++"), ("0", "40", " += 7")])
        test = ">" if step == "--" else "<"
        return ["%sfor (let %s = %s; %s %s %s; %s%s) {" % (pad, i, first, i, test, last, i, step), pad + "  burn();"] + block(with_name(scope, i, NUM), R.randint(1, 3), depth - 1, ret, indent + 1, True, log) + [pad + "}"]
    if w == "while":
        i = fresh("n")
        return ["%slet %s: number = %s;" % (pad, i, R.choice(SMALL)), "%swhile (%s-- > 0) {" % (pad, i), pad + "  burn();"] + block(with_name(scope, i, NUM), R.randint(1, 2), depth - 1, ret, indent + 1, True, log) + [pad + "}"]
    if w == "forof":
        found = scope.where(lambda u: u[0] in ("arr", "set", "map", "str"))
        if not found: return []
        n, u, _ = R.choice(found)
        each = fresh("each")
        if u[0] == "map":
            key = fresh("key")
            inner = with_name(with_name(scope, key, u[1]), each, u[2])
            head = "for (const [%s, %s] of %s) {" % (key, each, n)
        else:
            inner = with_name(scope, each, STR if u[0] == "str" else u[1])
            head = "for (const %s of %s) {" % (each, n)
        return [pad + head, pad + "  burn();"] + block(inner, R.randint(1, 3), depth - 1, ret, indent + 1, True, log) + [pad + "}"]
    if w == "forin":
        found = scope.where(lambda u: u[0] in ("rec", "arr", "dict"))
        if not found: return []
        key = fresh("key")
        return ["%sfor (const %s in %s) {" % (pad, key, R.choice(found)[0])] + [pad + "  burn();", "%s  %s.push(%s);" % (pad, log, key)] + block(with_name(scope, key, STR), R.randint(0, 1), depth - 1, ret, indent + 1, True, log) + [pad + "}"]
    if w == "try":
        lines = [pad + "try {"] + block(scope, R.randint(1, 3), depth - 1, ret, indent + 1, in_loop, log)
        if chance(0.5): lines.append("%s  if (%s) throw %s;" % (pad, expr(BOOL, scope, 1), R.choice(['new Error("thrown")', 'new RangeError("range")', 'new TypeError("type")', expr(STR, scope, 1), expr(NUM, scope, 1), "new Failure(%s)" % expr(NUM, scope, 1)])))
        kind = R.choice(["catch", "catch", "finally", "both"])
        if kind in ("catch", "both"):
            e = fresh("error")
            lines += ["%s} catch (%s) {" % (pad, e), "%s  %s.push(\"caught \" + describeError(%s));" % (pad, log, e), "%s  console.error(String(%s));" % (pad, e)] + block(scope, R.randint(0, 2), depth - 1, ret, indent + 1, in_loop, log)
        if kind in ("finally", "both"):
            lines += [pad + "} finally {", "%s  %s.push(\"finally\");" % (pad, log)] + block(scope, R.randint(0, 2), depth - 1, None, indent + 1, False, log)
        return lines + [pad + "}"]
    if w == "switch":
        found = scope.where(lambda u: u[0] in ("union", "lit", "enum", "num", "str"))
        if not found: return []
        n, u, _ = R.choice(found)
        lines = []
        if u[0] == "union":
            lines.append("%sswitch (%s.kind) {" % (pad, n))
            for member in unions[u[1]]:
                lines.append("%s  case %s: {" % (pad, kind_of(member)))
                lines += block(with_name(scope, n, ("rec", member)), R.randint(1, 2), depth - 1, ret, indent + 2, in_loop, log)
                lines.append("%s    break;" % pad)
                lines.append("%s  }" % pad)
        else:
            cases = list(u[1]) if u[0] == "lit" else ["%s.%s" % (u[1], m) for m in enums[u[1]][1]] if u[0] == "enum" else R.sample(SMALL + ["-1", "2147483647", "0.5"], 3) if u[0] == "num" else R.sample(STRINGS, 3)
            lines.append("%sswitch (%s) {" % (pad, "%s as %s" % (n, ts(u))))
            for c in cases[: R.randint(1, len(cases))]:
                lines.append("%s  case %s:" % (pad, c))
                lines += block(scope, R.randint(1, 2), depth - 1, ret, indent + 2, in_loop, log)
                if chance(0.75): lines.append("%s    break;" % pad)
            lines.append("%s  default:" % pad)
            lines += block(scope, 1, depth - 1, ret, indent + 2, in_loop, log)
        return lines + [pad + "}"]
    if w == "destructure":
        found = scope.where(lambda u: u[0] in ("rec", "tup"))
        if not found: return []
        n, u, _ = R.choice(found)
        if u[0] == "tup":
            names = [fresh("d") for _ in u[1]]
            for name, x in zip(names, u[1]): scope.add(name, x)
            return ["%sconst [%s] = %s;" % (pad, ", ".join(names), n)]
        fields = [f for f in all_fields(u[1]) if not f[2]]
        if not fields: return []
        chosen = R.sample(fields, R.randint(1, min(3, len(fields))))
        names = [fresh("d") for _ in chosen]
        for name, f in zip(names, chosen): scope.add(name, f[1])
        return ["%sconst { %s } = %s;" % (pad, ", ".join("%s: %s" % (f[0], name) for name, f in zip(names, chosen)), n)]
    if w == "closure":
        t = ("fn", tuple(R.choice([NUM, STR, BOOL]) for _ in range(R.randint(0, 2))), R.choice([NUM, STR, BOOL]))
        name = fresh("f")
        inner = Scope(scope)
        for i, p in enumerate(t[1]): inner.add("q%d" % i, p, True)
        lines = ["%sconst %s = (%s): %s => {" % (pad, name, ", ".join("q%d: %s" % (i, ts(p)) for i, p in enumerate(t[1])), ts(t[2]))]
        lines += block(inner, R.randint(0, 2), depth - 1, t[2], indent + 1, False, log) + ["%s  return %s;" % (pad, expr(t[2], inner, 2)), pad + "};"]
        scope.add(name, t)
        return lines
    if w == "collection":
        found = scope.where(lambda u: u[0] in ("arr", "map", "set"))
        if not found: return []
        n, u, _ = R.choice(found)
        if u[0] == "arr":
            e = lambda: expr(u[1], scope, 1)
            return [pad + R.choice(["%s.push(%s);" % (n, e()), "%s.push(%s, %s);" % (n, e(), e()), "%s.pop();" % n, "%s.shift();" % n, "%s.unshift(%s);" % (n, e()), "%s.splice(%s, 1);" % (n, R.choice(SMALL)), "%s.splice(1, 0, %s);" % (n, e()), "%s.reverse();" % n, "%s.length = Math.min(%s.length, %s);" % (n, n, R.choice(SMALL)), "%s.fill(%s);" % (n, e()), "%s.sort();" % n if u[1] in (NUM, STR) else "%s.reverse();" % n, "%s.copyWithin(0, 1);" % n])]
        if u[0] == "map": return [pad + R.choice(["%s.set(%s, %s);" % (n, expr(u[1], scope, 1), expr(u[2], scope, 1)), "%s.delete(%s);" % (n, expr(u[1], scope, 1)), "%s.clear();" % n])]
        return [pad + R.choice(["%s.add(%s);" % (n, expr(u[1], scope, 1)), "%s.delete(%s);" % (n, expr(u[1], scope, 1)), "%s.clear();" % n])]
    if w == "delete":
        found = [("%s.%s" % (n, f)) for n, u, _ in scope.all() if u[0] == "rec" for f, _, optional, readonly in all_fields(u[1]) if optional and not readonly]
        found += ["%s[%s]" % (n, '"%s"' % R.choice([k for k in KEYS if k not in ("constructor", "toString", "valueOf")])) for n, u, _ in scope.all() if u[0] == "dict"]
        return ["%sdelete %s;" % (pad, R.choice(found))] if found else []
    if w == "labeled":
        label, i, j = fresh("outer"), fresh("i"), fresh("j")
        inner = with_name(with_name(scope, i, NUM), j, NUM)
        return ["%s%s: for (let %s = 0; %s < 3; %s++) {" % (pad, label, i, i, i), "%s  for (let %s = 0; %s < 3; %s++) {" % (pad, j, j, j), pad + "    burn();", "%s    if (%s) %s %s;" % (pad, expr(BOOL, inner, 1), R.choice(["break", "continue"]), label)] + block(inner, R.randint(1, 2), depth - 1, ret, indent + 2, True, log) + [pad + "  }", pad + "}"]
    if w in ("break", "continue"):
        return ["%sif (%s) %s;" % (pad, expr(BOOL, scope, 1), w)]
    if w == "return":
        return ["%sif (%s) return %s;" % (pad, expr(BOOL, scope, 1), expr(ret, scope, 2))]
    return []


def unnarrowed(e, t):
    """A variable of a union type takes the type of what is assigned to it. Through a call it keeps the declared one."""
    if t[0] in ("union", "opt", "nul", "lit", "enum", "bool") and not e.startswith("of<%s>(" % ts(t)): return "of<%s>(%s)" % (ts(t), e)
    return e


def hole(scope, pad, log):
    """A value that TypeScript takes for its type and that is undefined when the program runs. It joins the scope, so typed code goes on to use it."""
    t = R.choice([NUM, NUM, NUM, STR, BOOL, random_type(1), random_type(1)])
    name = fresh("u")
    arrays = scope.where(lambda u: u[0] == "arr")
    ways = ["closure", "closure", "closure", "record", "sparse", "pattern", "longer", "parameter", "late"]
    if arrays: ways += ["beyond"] * 3
    numeric = [n for n in enums if not enums[n][0]]
    w = R.choice(ways)
    if w == "beyond":
        a, u, _ = R.choice(arrays)
        scope.add(name, u[1])
        return ["%sconst %s: %s = %s[%s];" % (pad, name, ts(u[1]), a, R.choice(["%s.length" % a, "99", "-1", "%s.length + 1" % a, "4294967295", "1.5"]))]
    if w == "closure":
        read = fresh("read")
        scope.add(read, ("fn", (), t))
        lines = ["%slet %s: %s;" % (pad, name, ts(t)), "%sconst %s = (): %s => %s;" % (pad, read, ts(t), name)]
        early = fresh("u")
        lines.append("%sconst %s: %s = %s();" % (pad, early, ts(t), read))
        scope.add(early, t)
        lines.append("%s%s = %s;" % (pad, name, make(t, 1)))
        return lines
    if w == "late":
        read = fresh("read")
        lines = ["%sconst %s = (): %s => %s;" % (pad, read, ts(t), name), "%stry { %s.push(%s); } catch (dead) { %s.push(\"dead zone \" + describeError(dead)); }" % (pad, log, tell("%s()" % read, t), log), "%sconst %s: %s = %s;" % (pad, name, ts(t), unnarrowed(make(t, 1), t))]
        scope.add(name, t)
        return lines
    if w == "record":
        table = fresh("table")
        scope.add(name, t)
        return ["%sconst %s: Record<string, %s> = { present: %s };" % (pad, table, ts(t), make(t, 1)), "%sconst %s: %s = %s[%s];" % (pad, name, ts(t), table, R.choice(['"absent"', '"present"', '"toString2"', '"0"']))]
    if w == "sparse":
        list_ = fresh("list")
        scope.add(list_, ("arr", t))
        scope.add(name, t)
        return ["%sconst %s: %s = new Array<%s>(%s);" % (pad, list_, ts(("arr", t)), ts(t), R.choice(["1", "3", "5"])), "%sconst %s: %s = %s[0];" % (pad, name, ts(t), list_)]
    if w == "longer":
        list_ = fresh("list")
        scope.add(list_, ("arr", t))
        scope.add(name, t)
        return ["%sconst %s: %s = [%s];" % (pad, list_, ts(("arr", t)), make(t, 1)), "%s%s.length = 3;" % (pad, list_), "%sconst %s: %s = %s[2];" % (pad, name, ts(t), list_)]
    if w == "pattern":
        list_, first = fresh("list"), fresh("u")
        scope.add(first, t)
        scope.add(name, t)
        return ["%sconst %s: %s = [%s];" % (pad, list_, ts(("arr", t)), make(t, 1)), "%sconst [%s, %s] = %s;" % (pad, first, name, list_)]
    take = fresh("take")
    scope.add(name, t)
    return ["%sconst %s = (first: number, second: %s): %s => second;" % (pad, take, ts(t), ts(t)), "%sconst %s: %s = (%s as (first: number) => %s)(1);" % (pad, name, ts(t), take, ts(t))]


def kind_of(member):
    return next(t[1][0] for f, t, _, _ in records[member]["fields"] if f == "kind")


# ---------------------------------------------------------------- declarations

def declare_enum():
    name = fresh("E")
    is_string = chance(0.4)
    members = R.sample(["Red", "Green", "Blue", "Up", "Down", "None"], R.randint(2, 4))
    enums[name] = (is_string, members)
    body = ", ".join("%s = \"%s\"" % (m, m.lower()) for m in members) if is_string else ", ".join(m + (" = %s" % R.choice(["0", "1", "5", "-1", "100"]) if i == 0 and chance(0.5) else "") for i, m in enumerate(members))
    out.append("%senum %s { %s }" % ("const " if chance(0.3) else "", name, body))


def random_fields(own_name, taken, least=1):
    names = [f for f in FIELD_NAMES if f not in taken]
    fields = []
    for f in R.sample(names, R.randint(least, 5)):
        t = random_type(2)
        optional = chance(0.2) and t[0] not in ("opt",)
        fields.append((f, t, optional, chance(0.1)))
    return fields


def declare_record():
    name = fresh("T")
    fields = random_fields(name, [])
    kind = R.choice(["interface", "type"])
    base = None
    if kind == "interface" and chance(0.25):
        bases = [n for n in records if records[n]["kind"] == "interface" and not any(f[0] == "kind" for f in all_fields(n))]
        if bases:
            base = R.choice(bases)
            taken = {f[0] for f in all_fields(base)}
            fields = [f for f in fields if f[0] not in taken]
    records[name] = dict(kind=kind, fields=fields, base=base, methods=[], ctor=[])
    if chance(0.2): fields.append(("next", ("rec", name), True, False))
    body = " ".join("%s%s%s: %s;" % ("readonly " if ro else "", f, "?" if o else "", ts(t)) for f, t, o, ro in fields)
    out.append("interface %s%s { %s }" % (name, " extends " + base if base else "", body) if kind == "interface" else "type %s = { %s };" % (name, body))


def declare_union():
    name = fresh("U")
    members = []
    for tag in R.sample(["circle", "square", "line", "point"], R.randint(2, 3)):
        member = fresh("T")
        fields = [("kind", ("lit", ('"%s"' % tag,)), False, True)] + random_fields(member, ["kind"], 0)
        records[member] = dict(kind="type", fields=fields, base=None, methods=[], ctor=[])
        out.append("type %s = { %s };" % (member, " ".join("%s%s%s: %s;" % ("readonly " if ro else "", f, "?" if o else "", ts(t)) for f, t, o, ro in fields)))
        members.append(member)
    unions[name] = members
    out.append("type %s = %s;" % (name, " | ".join(members)))


def declare_class():
    name = fresh("C")
    base = None
    classes = [n for n in records if records[n]["kind"] == "class"]
    if classes and chance(0.45): base = R.choice(classes)
    taken = [f[0] for f in all_fields(base)] + [m["name"] for m in methods_of(base)] if base else []
    fields = [f for f in random_fields(name, taken, 0) if True]
    style = R.choice(["initializers", "parameters", "assigned"])
    record = dict(kind="class", fields=fields, base=base, methods=[], ctor=[])
    records[name] = record
    lines = ["class %s%s {" % (name, " extends " + base if base else "")]
    base_parameters = constructor_parameters(base) if base else []
    this = Scope()
    if style == "initializers":
        for f, t, o, ro in fields:
            lines.append("  %s%s%s: %s%s;" % ("readonly " if ro else "", f, "?" if o else "", ts(t), "" if o and chance(0.5) else " = " + make(t, 1)))
        if base_parameters and chance(0.5) or False:
            pass
    elif style == "parameters":
        record["ctor"] = [(f, ("opt", t) if o and t[0] != "opt" else t) for f, t, o, ro in fields]
        own = ", ".join("%s %s%s: %s" % ("public readonly" if ro else "public", f, "", ts(("opt", t) if o and t[0] != "opt" else t)) for f, t, o, ro in fields)
        record["fields"] = fields = [(f, ("opt", t) if o and t[0] != "opt" else t, False, ro) for f, t, o, ro in fields]
        inherited = ", ".join("%s_: %s" % (f, ts(t)) for f, t in base_parameters)
        lines.append("  constructor(%s) {%s }" % (", ".join(x for x in (inherited, own) if x), " super(%s);" % ", ".join(f + "_" for f, _ in base_parameters) if base else ""))
    else:
        required = [(f, t) for f, t, o, ro in fields if not o]
        record["ctor"] = required
        for f, t, o, ro in fields:
            lines.append("  %s%s%s: %s;" % ("readonly " if ro else "", f, "?" if o else "", ts(t)))
        inherited = ["%s_: %s" % (f, ts(t)) for f, t in base_parameters]
        lines.append("  constructor(%s) {" % ", ".join(inherited + ["%s: %s" % (f, ts(t)) for f, t in required]))
        if base: lines.append("    super(%s);" % ", ".join(f + "_" for f, _ in base_parameters))
        order = list(required)
        if chance(0.4): R.shuffle(order)
        for f, t in order: lines.append("    this.%s = %s;" % (f, f))
        lines.append("  }")
    if chance(0.4):
        t = R.choice([NUM, STR])
        hidden, visible = "#" + fresh("h"), fresh("g")
        setter = chance(0.6)
        lines.append("  %s: %s = %s;" % (hidden, ts(t), make(t, 0)))
        lines.append("  get %s(): %s { return this.%s; }" % (visible, ts(t), hidden))
        if setter: lines.append("  set %s(next: %s) { this.%s = next; }" % (visible, ts(t), hidden))
        record["methods"].append(dict(name=visible, kind="getter", params=[], ret=t, setter=setter))
    if chance(0.3):
        lines.append("  static made: number = %s;" % R.choice(SMALL))
    this.add("this", ("rec", name))
    for _ in range(R.randint(0, 3)):
        m = fresh("m")
        params = [R.choice([NUM, STR, BOOL, random_type(1)]) for _ in range(R.randint(0, 2))]
        ret = R.choice([NUM, STR, BOOL, random_type(1)])
        inner = Scope(this)
        for i, p in enumerate(params): inner.add("p%d" % i, p, True)
        lines.append("  %s(%s): %s {" % (m, ", ".join("p%d: %s" % (i, ts(p)) for i, p in enumerate(params)), ts(ret)))
        lines.append("    const seen: string[] = [];")
        lines += block(inner, R.randint(0, 3), 1, ret, 2)
        lines.append("    return %s;" % expr(ret, inner, 2))
        lines.append("  }")
        record["methods"].append(dict(name=m, kind="method", params=params, ret=ret, setter=False))
    if base:
        overridable = [m for m in methods_of(base) if m["kind"] == "method"]
        if overridable and chance(0.6):
            m = R.choice(overridable)
            inner = Scope(this)
            for i, p in enumerate(m["params"]): inner.add("p%d" % i, p, True)
            arguments = ", ".join("p%d" % i for i in range(len(m["params"])))
            lines.append("  override %s(%s): %s {" % (m["name"], ", ".join("p%d: %s" % (i, ts(p)) for i, p in enumerate(m["params"])), ts(m["ret"])))
            lines.append("    if (%s) return super.%s(%s);" % (expr(BOOL, inner, 1), m["name"], arguments))
            lines.append("    return %s;" % expr(m["ret"], inner, 2))
            lines.append("  }")
    lines.append("}")
    out.extend(lines)


def declare_show_functions():
    for name, r in records.items():
        parts = []
        for f, t, optional, _ in all_fields(name):
            u = ("opt", t) if optional and t[0] != "opt" else t
            parts.append('"%s:" + %s' % (f, show("v." + f, u, 1)))
        for m in methods_of(name):
            if m["kind"] == "getter": parts.append('"%s:" + %s' % (m["name"], show("v." + m["name"], m["ret"], 1)))
        out.append("function show%s(v: %s): string { return \"%s{\" + %s + \"}\"; }" % (name, name, name, ' + "," + '.join(parts) if parts else '""'))
    for name, members in unions.items():
        out.append("function show%s(v: %s): string { switch (v.kind) { %s } }" % (name, name, " ".join("case %s: return show%s(v);" % (kind_of(m), m) for m in members)))


def declare_function():
    name = fresh("fn")
    params = [random_type(2) for _ in range(R.randint(0, 4))]
    ret = random_type(2)
    scope = Scope()
    for i, p in enumerate(params): scope.add("p%d" % i, p, True)
    style = R.choice(["function", "function", "arrow"])
    head = "function %s(%s): %s {" if style == "function" else "const %s = (%s): %s => {"
    has_default = bool(params) and chance(0.25)
    if has_default: defaulted.add(name)
    out.append(head % (name, ", ".join("p%d: %s%s" % (i, ts(p), " = " + unnarrowed(make(p, 1), p) if has_default and i == len(params) - 1 else "") for i, p in enumerate(params)), ts(ret)))
    out.append("  const seen: string[] = [];")
    out.append("  burn();")
    out.extend(block(scope, R.randint(1, 6), 2, ret, 1))
    if chance(0.3): out.append("  trace.push(seen.join(\";\"));")
    tail = [f for f in functions if f[2] == ret and not f[3] and not f[4]]
    if tail and chance(0.3):
        callee = R.choice(tail)
        out.append("  return %s(%s);" % (callee[0], ", ".join(expr(p, scope, 1) for p in callee[1])))
    else:
        out.append("  return %s;" % expr(ret, scope, 2))
    out.append("}" if style == "function" else "};")
    functions.append((name, params, ret, False, False))


def declare_generator():
    name = fresh("gen")
    t = R.choice([NUM, STR, random_type(1)])
    params = [random_type(1) for _ in range(R.randint(0, 2))]
    scope = Scope()
    for i, p in enumerate(params): scope.add("p%d" % i, p, True)
    out.append("function* %s(%s): Generator<%s, void, unknown> {" % (name, ", ".join("p%d: %s" % (i, ts(p)) for i, p in enumerate(params)), ts(t)))
    out.append("  const seen: string[] = [];")
    for _ in range(R.randint(1, 4)):
        out.extend(block(scope, R.randint(0, 2), 1, None, 1))
        if chance(0.25):
            out.append("  try { yield %s; } finally { trace.push(\"%s closed\"); }" % (expr(t, scope, 2), name))
        elif chance(0.3):
            out.append("  for (let i = 0; i < %s; i++) yield (burn(), %s);" % (R.choice(SMALL), expr(t, with_name(scope, "i", NUM), 2)))
        else:
            out.append("  yield %s;" % expr(t, scope, 2))
    out.append("}")
    functions.append((name, params, t, False, True))


def declare_async_function():
    name = fresh("later")
    params = [random_type(1) for _ in range(R.randint(0, 2))]
    ret = random_type(1)
    scope = Scope()
    for i, p in enumerate(params): scope.add("p%d" % i, p, True)
    out.append("async function %s(%s): Promise<%s> {" % (name, ", ".join("p%d: %s" % (i, ts(p)) for i, p in enumerate(params)), ts(ret)))
    out.append("  const seen: string[] = [];")
    for _ in range(R.randint(1, 3)):
        out.extend(block(scope, R.randint(0, 2), 1, ret, 1))
        out.append("  trace.push(\"%s step\");" % name)
        earlier = [f for f in functions if f[3]]
        if earlier and chance(0.5):
            callee = R.choice(earlier)
            v = fresh("w")
            out.append("  const %s: %s = await %s(%s);" % (v, ts(callee[2]), callee[0], ", ".join(expr(p, scope, 1) for p in callee[1])))
            scope.add(v, callee[2])
        else:
            out.append("  await %s;" % R.choice(["null", "Promise.resolve(1)", "undefined", "new Promise<void>(resolve => void Promise.resolve().then(resolve))", "{ then(resolve: (value: number) => void) { resolve(1); } }"]))
    if chance(0.2): out.append("  if (%s) throw new Failure(%s);" % (expr(BOOL, scope, 1), expr(NUM, scope, 1)))
    out.append("  return %s;" % expr(ret, scope, 2))
    out.append("}")
    functions.append((name, params, ret, True, False))


PRELUDE = r'''declare const console: { log(...values: unknown[]): void; error(...values: unknown[]): void };
const trace: string[] = [];
let fuel = 0;
class OutOfFuel extends Error {}
function burn(): void { if (--fuel < 0) throw new OutOfFuel("fuel"); }
function clip(text: string): string { return text.length > 400 ? text.slice(0, 400) : text; }
function of<T>(value: T): T { return value; }
function total(...all: number[]): number { let sum = 0; for (const each of all) sum += each; return sum; }
function num(value: number): string { return Object.is(value, -0) ? "-0" : String(value); }
class Failure extends Error { constructor(public code: number) { super("failure " + code); this.name = "Failure"; } }
class Box<T> {
  constructor(public value: T) {}
  get(): T { return this.value; }
  with(next: T): Box<T> { return new Box<T>(next); }
}
function describeError(error: unknown): string {
  if (error instanceof Failure) return "Failure " + num(error.code);
  if (error instanceof OutOfFuel) return "OutOfFuel";
  if (error instanceof Error) return error.name;
  return typeof error + " " + String(error);
}
function inspect(value: unknown, depth: number = 0): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "number") return num(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean" || typeof value === "symbol" || typeof value === "bigint") return String(value);
  if (typeof value === "function") return "fn/" + value.length;
  if (depth > 3) return "...";
  if (value instanceof Map) return "Map{" + [...value].map(([k, v]) => inspect(k, depth + 1) + "=>" + inspect(v, depth + 1)).join(",") + "}";
  if (value instanceof Set) return "Set{" + [...value].map(v => inspect(v, depth + 1)).join(",") + "}";
  if (value instanceof Error) return describeError(value);
  const flags = (Object.isFrozen(value) ? "F" : Object.isSealed(value) ? "S" : Object.isExtensible(value) ? "" : "N");
  const parts: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    const d = Reflect.getOwnPropertyDescriptor(value, key)!;
    const marks = (d.enumerable ? "" : "~") + ("value" in d ? (d.writable ? "" : "!") : "@");
    if (Array.isArray(value) && key === "length") continue;
    parts.push(String(key) + marks + ":" + inspect((value as Record<PropertyKey, unknown>)[key], depth + 1));
  }
  const proto = Object.getPrototypeOf(value);
  const name = Array.isArray(value) ? "[]" : proto === null ? "null" : proto === Object.prototype ? "" : typeof proto.constructor === "function" ? proto.constructor.name : "?";
  return name + flags + "{" + parts.join(",") + "}";
}
function launderAny(value: any, how: number): any {
  if (value === null || typeof value !== "object") return value;
  const keys = Object.keys(value);
  switch (how) {
    case 0: return value;
    case 1: value.extra = 1; return value;
    case 2: value.extra = 1; delete value.extra; return value;
    case 3: return Object.freeze(value);
    case 4: return Object.seal(value);
    case 5: return Object.preventExtensions(value);
    case 6:
      for (const key of keys) {
        let held = value[key];
        Object.defineProperty(value, key, { get() { return held; }, set(next) { held = next; }, enumerable: true, configurable: true });
      }
      return value;
    case 7: for (const key of keys) Object.defineProperty(value, key, { enumerable: false }); return value;
    case 8: return Object.setPrototypeOf(value, Object.create(Object.getPrototypeOf(value)));
    case 9: return new Proxy(value, {});
    case 10:
      return new Proxy(value, {
        get(target, key, receiver) { if (typeof key === "string") trace.push("get " + key); return Reflect.get(target, key, receiver); },
        set(target, key, next, receiver) { if (typeof key === "string") trace.push("set " + key); return Reflect.set(target, key, next, receiver); },
        has(target, key) { if (typeof key === "string") trace.push("has " + key); return Reflect.has(target, key); },
        deleteProperty(target, key) { if (typeof key === "string") trace.push("delete " + key); return Reflect.deleteProperty(target, key); },
        ownKeys(target) { trace.push("ownKeys"); return Reflect.ownKeys(target); },
      });
    case 11: for (const key of [...keys].reverse()) { const held = value[key]; delete value[key]; value[key] = held; } return value;
    case 12: for (let i = 0; i < 70; i++) value["k" + i] = i; for (let i = 0; i < 70; i++) delete value["k" + i]; return value;
    case 13: value[Symbol.for("extra")] = 1; return value;
    case 14: value[0] = "indexed"; return value;
    case 15: if (keys.length) Object.defineProperty(value, keys[0], { writable: false }); return value;
    case 16:
      if (keys.length) {
        let held = value[keys[0]], reads = 0;
        Object.defineProperty(value, keys[0], { get() { if (++reads === 3) throw new RangeError("third read"); return held; }, set(next) { held = next; }, enumerable: true, configurable: true });
      }
      return value;
    case 17: for (const key of keys) value[key] = value[key]; return value;
    case 18: Object.assign(value, { ...value }); return value;
    case 19: return { ...value };
    case 20: return Object.assign(Object.create(null), value);
    case 21: return JSON.parse(JSON.stringify(value));
    case 22: return Object.assign(Object.create(Object.getPrototypeOf(value)), value);
    case 23: return Object.setPrototypeOf(value, Object.create(Object.getPrototypeOf(value), { inserted: { value: 1, configurable: true } }));
  }
  return value;
}
function launder<T>(value: T, how: number): T { return launderAny(value, how); }
function launderArray<T>(value: T[], how: number): T[] {
  const list: any = value;
  switch (how) {
    case 0: return list;
    case 1: list.extra = 1; return list;
    case 2: return Object.freeze(list);
    case 3: return new Proxy(list, {});
    case 4: list[list.length + 1000] = list[0]; list.length -= 1001; return list;
    case 5: return Object.seal(list);
    case 6: if (list.length) { let held = list[0]; Object.defineProperty(list, 0, { get() { return held; }, set(next) { held = next; }, enumerable: true, configurable: true }); } return list;
    case 7: return Object.setPrototypeOf(list, Object.create(Array.prototype));
    case 8: { class Listing extends Array<any> {} return Listing.from(list); }
    case 9: return JSON.parse(JSON.stringify({ list: [] })).list.concat(list);
  }
  return list;
}
function say(label: string, make: () => string): void {
  let text: string;
  fuel = 3000;
  try { text = make(); } catch (error) { text = "THROWS " + describeError(error); console.error(label, String(error)); }
  print(label + ": " + text + (trace.length ? " | " + trace.splice(0).join(";") : ""));
}
async function sayLater(label: string, make: () => Promise<string>): Promise<void> {
  let text: string;
  fuel = 3000;
  try { text = await make(); } catch (error) { text = "THROWS " + describeError(error); console.error(label, String(error)); }
  print(label + ": " + text + (trace.length ? " | " + trace.splice(0).join(";") : ""));
}
'''


def episode(index):
    label = "e%d" % index
    scope = Scope()
    kind = R.choice(["plain"] * 6 + ["generator", "async", "async", "hot"])
    generators = [f for f in functions if f[4]]
    asyncs = [f for f in functions if f[3]]
    if kind == "generator" and generators:
        g = R.choice(generators)
        out.append("say(\"%s\", (): string => {" % label)
        out.append("  const seen: string[] = [];")
        out.append("  let taken = 0;")
        out.append("  for (const each of %s(%s)) {" % (g[0], ", ".join(make(p, 2) for p in g[1])))
        out.append("    seen.push(%s);" % tell("each", g[2]))
        out.append("    if (++taken >= %s) break;" % R.choice(["1", "2", "3", "100"]))
        out.append("  }")
        out.append("  return seen.join(\";\");")
        out.append("});")
        return
    if kind == "async" and asyncs:
        chosen = [R.choice(asyncs) for _ in range(R.randint(1, 3))]
        out.append("await sayLater(\"%s\", async (): Promise<string> => {" % label)
        if len(chosen) > 1 and chance(0.6):
            out.append("  const all = await Promise.allSettled([%s]);" % ", ".join("%s(%s)" % (f[0], ", ".join(make(p, 2) for p in f[1])) for f in chosen))
            out.append("  return all.map(each => each.status === \"fulfilled\" ? inspect(each.value) : \"rejected \" + describeError(each.reason)).join(\";\");")
        else:
            f = chosen[0]
            out.append("  const got: %s = await %s(%s);" % (ts(f[2]), f[0], ", ".join(make(p, 2) for p in f[1])))
            out.append("  return %s;" % tell("got", f[2]))
        out.append("});")
        return
    plain = [f for f in functions if not f[3] and not f[4]]
    if kind == "hot" and plain:
        f = R.choice(plain)
        out.append("say(\"%s\", (): string => {" % label)
        out.append("  let last = \"\";")
        out.append("  for (let round = 0; round < %s; round++) last = %s;" % (R.choice(["3", "20", "200"]), tell("%s(%s)" % (f[0], ", ".join(make(p, 2) for p in f[1])), f[2])))
        out.append("  trace.length = Math.min(trace.length, 3);")
        out.append("  return last;")
        out.append("});")
        return
    out.append("say(\"%s\", (): string => {" % label)
    out.append("  const seen: string[] = [];")
    out.extend(block(scope, R.randint(3, 9), 2, STR, 1))
    out.append("  return seen.join(\";\");")
    out.append("});")


IN_WORKERS = r'''import { isMainThread, parentPort, Worker } from "node:worker_threads";
const printed: string[] = [];
function print(line: string): void { printed.push(line); }
const fromWorkers: string[][] = [];
const workersDone: Promise<void> = new Promise<void>(resolve => {
  if (!isMainThread) return resolve();
  let waiting = COUNT;
  for (let n = 0; n < COUNT; n++) {
    const worker = new Worker("./main.ts");
    worker.on("message", (lines: string[]) => { fromWorkers[n] = lines; if (!--waiting) resolve(); });
    worker.on("error", (error: unknown) => { fromWorkers[n] = ["worker error " + String(error)]; if (!--waiting) resolve(); });
  }
});
'''
AFTER_WORKERS = r'''if (isMainThread) {
  await workersDone;
  for (const line of printed) console.log(line);
  fromWorkers.forEach((lines, n) => console.log("worker " + n + (lines.join("\n") === printed.join("\n") ? " agrees" : " DISAGREES\n" + lines.join("\n"))));
} else {
  parentPort!.postMessage(printed);
}'''


def main():
    out.append(IN_WORKERS.replace("COUNT", str(R.randint(2, 4))) if WORKERS else "function print(line: string): void { console.log(line); }")
    out.append(PRELUDE)
    for _ in range(R.randint(0, 2)): declare_enum()
    for _ in range(R.randint(3, 7)):
        R.choice([declare_record, declare_record, declare_class, declare_class, declare_union])()
    declare_show_functions()
    for _ in range(R.randint(3, 9)):
        R.choice([declare_function] * 5 + [declare_generator, declare_async_function])()
    for i in range(R.randint(6, 16)):
        episode(i)
    out.append(AFTER_WORKERS if WORKERS else "export {};")
    print("\n".join(out))


main()
