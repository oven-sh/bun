#!/usr/bin/env python3
"""unions-of-look-alike-classes.py <seed>: well-typed TypeScript. Three or four classes have the same members under the same names, and each keeps them its own way: in another order, as a field stored in the constructor, as a field with an initializer, as an accessor, inherited from a base class. A value typed as their union, with or without null and undefined, is held in a parameter, a field, an element, a captured variable or a destructured parameter, and a function reads several members of it one after the other: plainly, behind `!`, `?.`, a test for null, `instanceof`, `in`, in closures that are called at once, in loops, under try. One class runs hot first, then each of the others arrives, then null and undefined. A compiler that splits the union for one member and tests the value once for the next has to keep apart what each test has proven of which class. Every line is as in plain Bun."""
import random, sys

seed = int(sys.argv[1])
R = random.Random(seed)

MEMBERS = [
    ("a", "number", lambda k: "%d.5" % (k + 1)),
    ("b", "number", lambda k: "%d" % (k + 2)),
    ("c", "string", lambda k: '"c%d"' % k),
    ("d", "{ k: number }", lambda k: "{ k: %d }" % (k + 3)),
    ("e", "boolean", lambda k: "true" if k & 1 else "false"),
    ("f", "number[]", lambda k: "[%d, %d.5]" % (k, k)),
]

print('''function errorName(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : typeof error);
}
function describe(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || typeof value !== "object") return String(value);
  return JSON.stringify(value);
}
function see(run: () => unknown): string {
  try {
    return describe(run());
  } catch (error) {
    return errorName(error);
  }
}
const log: string[] = [];
// What code nobody has seen may hold, no analysis of the whole program says much about: the functions below then go by their types and by tests.
function escape<T>(value: T): T {
  (globalThis as any)["kept" + String(log.length).slice(1)] = value;
  return value;
}''')

count = R.choice([2, 3, 3, 4])
names = ["C%d" % index for index in range(count)]
used = MEMBERS[: R.choice([3, 4, 5, 6])]
for index, name in enumerate(names):
    order = used[:]
    R.shuffle(order)
    above = []
    body = []
    stores = []
    for member, type_, value in order:
        kind = R.choice(["store", "store", "initializer", "initializer", "accessor", "getter", "above"])
        if index == 0 and kind in ("accessor", "getter") and R.random() < 0.7:
            kind = "store"
        if kind == "store":
            body.append("  %s: %s;" % (member, type_))
            stores.append("this.%s = %s;" % (member, value(index)))
        elif kind == "initializer":
            body.append("  %s: %s = %s;" % (member, type_, value(index)))
        elif kind == "accessor":
            body.append("  get %s(): %s { return %s; }\n  set %s(value: %s) { log.push(\"%s.%s\"); }" % (member, type_, value(index), member, type_, name, member))
        elif kind == "getter":
            body.append("  get %s(): %s { return %s; }" % (member, type_, value(index)))
        else:
            above.append("  %s: %s = %s;" % (member, type_, value(index)))
    extra = R.random() < 0.4
    if extra:
        body.insert(R.randrange(len(body) + 1), "  own%d: number = %d.25;" % (index, index))
    if above:
        print("class Above%d {\n%s\n}" % (index, "\n".join(above)))
    print("class %s%s {\n%s\n  constructor() { %s%s }\n}" % (name, " extends Above%d" % index if above else "", "\n".join(body), "super(); " if above else "", " ".join(stores)))

nullish = R.choice(["", " | null", " | undefined", " | null | undefined", " | null | undefined"])
union = " | ".join(names)
print("type U = %s%s;" % (union, nullish))

USES = {
    "number": ["%s", "%s + 1", "%s * 2", "Math.floor(%s)", "%s.toFixed(1)", "%s > 1"],
    "string": ["%s", "%s.length", "%s + \"!\"", "%s.charCodeAt(0)", "%s.toUpperCase()"],
    "{ k: number }": ["%s.k", "%s.k + 1", "%s", "typeof %s"],
    "boolean": ["%s", "!%s", "%s ? 1 : 2"],
    "number[]": ["%s.length", "%s[1]", "%s[0] + 1", "%s.join()"],
}


def read(holder, how):
    member, type_, _ = R.choice(used)
    access = {"plain": "%s.%s", "bang": "%s!.%s", "chain": "%s?.%s"}[how] % (holder, member)
    use = R.choice(USES[type_])
    if how == "chain" and use != "%s":
        use = R.choice(["%s", "typeof %s", "%s ?? \"none\""])
    return use % access


readers = []
for number in range(R.choice([2, 3, 4])):
    held = R.choice(["parameter", "parameter", "field", "element", "captured", "destructured"])
    holder = {"parameter": "v", "field": "keeper.held", "element": "list[0]", "captured": "v", "destructured": "v"}[held]
    how = "plain" if not nullish else R.choice(["bang", "bang", "chain", "tested"])
    lines = []
    if held == "field":
        lines.append("  const keeper = new Keeper(v);")
    if held == "element":
        lines.append("  const list: U[] = [v];")
    if how == "tested":
        test = R.choice(["if (%s == null) return \"nullish\";", "if (!%s) return \"nullish\";", "if (%s === null || %s === undefined) return \"nullish\";"])
        # A test narrows a parameter or a constant, not a member.
        if held in ("field", "element"):
            lines.append("  const w = %s;" % holder)
            holder = "w"
        lines.append("  " + test.replace("%s", holder))
        how = "plain"
    lines.append("  let out = \"\";")
    for step in range(R.randrange(3, 9)):
        form = R.choice(["closure", "closure", "straight", "straight", "instanceof", "in", "loop", "try"])
        if form == "closure":
            narrowable = how == "plain" and holder in ("v", "w") and nullish
            lines.append("  out += \" %d:\" + see(() => %s);" % (step, read(holder, "bang" if narrowable else how)))
        elif form == "straight":
            lines.append("  out += \" %d:\" + describe(%s);" % (step, read(holder, how)))
        elif form == "instanceof":
            which = R.choice(names)
            target = holder
            if holder not in ("v", "w"):
                lines.append("  const t%d = %s;" % (step, holder))
                target = "t%d" % step
            lines.append("  if (%s instanceof %s) out += \" %d:\" + describe(%s); else out += \" %d:\" + describe(%s);" % (target, which, step, read(target, "plain"), step, read(target, how)))
        elif form == "in":
            lines.append("  out += \" %d:\" + see(() => \"%s\" in (%s as object));" % (step, R.choice(used)[0], holder))
        elif form == "loop":
            lines.append("  for (let turn = 0; turn < 2; turn++) out += \" %d:\" + describe(%s);" % (step, read(holder, how)))
        else:
            lines.append("  try { out += \" %d:\" + describe(%s); } catch (error) { out += \" %d:\" + errorName(error); }" % (step, read(holder, how), step))
    lines.append("  return out;")
    head = "function reader%d(v: U): string {" % number
    if held == "destructured":
        head = "function reader%d({ held: v }: { held: U }): string {" % number
    readers.append((number, held))
    print(head + "\n" + "\n".join(lines) + "\n}")

print("class Keeper {\n  constructor(public held: U) {}\n}")
print("function run(name: string, v: U): void {")
for number, held in readers:
    argument = "{ held: v }" if held == "destructured" else "v"
    print("  console.log(name + \" reader%d\" + see(() => reader%d(%s)));" % (number, number, argument))
print("}")
first = R.choice(names)
escapes = R.random() < 0.7
made = "escape(new %s())" if escapes else "new %s()"
print("const hot: U = %s;" % (made % first))
print("let warm = 0;")
print("for (let turn = 0; turn < %d; turn++) {" % R.choice([50, 300, 2000]))
for number, held in readers:
    argument = "{ held: hot }" if held == "destructured" else "hot"
    print("  warm += reader%d(%s).length;" % (number, argument))
print("}")
print("console.log(\"warm \" + warm);")
arrivals = names[:]
R.shuffle(arrivals)
for name in arrivals:
    print("run(\"%s\", %s);" % (name, made % name))
if "null" in nullish:
    print("run(\"null\", null);")
if "undefined" in nullish:
    print("run(\"undefined\", undefined);")
print("run(\"hot again\", hot);")
print("console.log(\"log \" + log.join());")
print("export {};")
