#!/usr/bin/env python3
"""resource-management.py <seed>: `using` and `await using` declarations in random blocks, left in every way.

Resources are opened in nested blocks, loops, `for (using ..)` heads, generators, async functions and closures. A block is left by running to its end, by
return, throw, break, continue, a labeled jump, by closing a generator early. A resource may be null or undefined, may throw when it is
closed, may lack a dispose method, may have only the synchronous one under `await using`. DisposableStack and AsyncDisposableStack are used,
moved and disposed twice. What is printed: the order in which everything is opened and closed, what comes back, and the whole
chain of a SuppressedError. As plain Bun, line by line."""
import random, sys

seed = int(sys.argv[1]) if len(sys.argv) > 1 else 1
R = random.Random(seed)
counter = [0]


def fresh(prefix):
    counter[0] += 1
    return "%s%d" % (prefix, counter[0])


def chance(p):
    return R.random() < p


PRELUDE = r'''declare const console: { log(...values: unknown[]): void; error(...values: unknown[]): void };
const log: string[] = [];
class Resource {
  constructor(public name: string, public failsToClose: boolean = false) { log.push("open " + name); }
  [Symbol.dispose](): void {
    log.push("close " + this.name);
    if (this.failsToClose) throw new Error("closing " + this.name);
  }
}
class AsyncResource {
  constructor(public name: string, public failsToClose: boolean = false) { log.push("open " + name); }
  async [Symbol.asyncDispose](): Promise<void> {
    log.push("closing " + this.name);
    await null;
    log.push("closed " + this.name);
    if (this.failsToClose) throw new Error("closing " + this.name);
  }
}
class Derived extends Resource {
  override [Symbol.dispose](): void { log.push("derived"); super[Symbol.dispose](); }
}
function literal(name: string, failsToClose: boolean = false): Disposable {
  log.push("open " + name);
  return { [Symbol.dispose]() { log.push("close " + name); if (failsToClose) throw new RangeError("closing " + name); } };
}
function describe(error: unknown): string {
  if (error instanceof SuppressedError) return "Suppressed(" + describe(error.error) + " after " + describe(error.suppressed) + ")";
  if (error instanceof Error) return error.name + " " + error.message;
  return typeof error + " " + String(error);
}
function tell(label: string, text: string): void { console.log(label + ": " + text + " | " + log.splice(0).join(", ")); }
function say(label: string, run: () => unknown): void {
  let text: string;
  try { text = String(run()); } catch (error) { text = "THROWS " + describe(error); console.error(label, String(error)); }
  tell(label, text);
}
async function sayLater(label: string, run: () => Promise<unknown>): Promise<void> {
  let text: string;
  try { text = String(await run()); } catch (error) { text = "THROWS " + describe(error); console.error(label, String(error)); }
  tell(label, text);
}
'''


def resource(is_async):
    name = fresh("r")
    fails = "true" if chance(0.2) else "false"
    ways = ['new Resource("%s", %s)' % (name, fails)] * 4 + ['new Derived("%s", %s)' % (name, fails), 'literal("%s", %s)' % (name, fails), "null", "undefined", '(x > 1 ? new Resource("%s", %s) : null)' % (name, fails), '(x %% 2 ? new Resource("%s") : undefined)' % name]
    if is_async: ways += ['new AsyncResource("%s", %s)' % (name, fails)] * 6
    return R.choice(ways)


def declaration(pad, is_async):
    keyword = "await using" if is_async and chance(0.6) else "using"
    n = R.choice([1, 1, 1, 2, 3])
    return "%s%s %s;" % (pad, keyword, ", ".join("%s = %s" % (fresh("u"), resource(keyword != "using")) for _ in range(n)))


def leave(pad, in_loop, labels, in_generator):
    ways = ['return "returned " + x;', 'throw new Error("thrown " + x);', 'throw "text";'] if not in_generator else ["return;", 'throw new Error("thrown " + x);']
    if in_loop: ways += ["break;", "continue;"] * 2
    ways += ["break %s;" % label for label in labels]
    return "%sif ((x as number) %s %s) %s" % (pad, R.choice([">", "<", "===", "!=="]), R.choice("0123"), R.choice(ways))


def block(depth, indent, is_async, in_loop=False, labels=(), in_generator=False):
    pad = "  " * indent
    lines = []
    for _ in range(R.randint(1, 4)):
        w = R.choice(["using"] * 5 + ["log", "leave", "leave", "await" if is_async else "log", "yield" if in_generator else "log"] + (["block", "block", "try", "try", "for", "forof", "forusing", "labeled", "closure", "stack", "switch", "if"] if depth > 0 else []))
        inner = lambda **more: block(depth - 1, indent + 1, is_async, more.get("in_loop", in_loop), more.get("labels", labels), in_generator)
        if w == "using": lines.append(declaration(pad, is_async))
        elif w == "log": lines.append('%slog.push("%s");' % (pad, fresh("at")))
        elif w == "leave": lines.append(leave(pad, in_loop, labels, in_generator))
        elif w == "await": lines.append("%sawait %s;" % (pad, R.choice(["null", "Promise.resolve()", "undefined"])))
        elif w == "yield": lines.append('%syield "%s";' % (pad, fresh("y")))
        elif w == "block": lines += [pad + "{"] + inner() + [pad + "}"]
        elif w == "if": lines += ["%sif (x %% 2) {" % pad] + inner() + [pad + "} else {"] + inner() + [pad + "}"]
        elif w == "try":
            lines += [pad + "try {"] + inner()
            kind = R.choice(["catch", "finally", "both"])
            if kind != "finally": lines += [pad + "} catch (error) {", '%s  log.push("caught " + describe(error));' % pad] + (inner() if chance(0.4) else [])
            if kind != "catch": lines += [pad + "} finally {", '%s  log.push("finally");' % pad] + ([declaration(pad + "  ", is_async)] if chance(0.4) else [])
            lines.append(pad + "}")
        elif w == "for":
            i = fresh("i")
            lines += ["%sfor (let %s = 0; %s < %s; %s++) {" % (pad, i, i, R.choice("123"), i)] + inner(in_loop=True) + [pad + "}"]
        elif w == "forof":
            keyword = "await using" if is_async and chance(0.5) else "using"
            lines += ["%sfor (%s %s of [%s]) {" % (pad, keyword, fresh("each"), ", ".join(resource(keyword != "using") for _ in range(R.randint(1, 3))))] + inner(in_loop=True) + [pad + "}"]
        elif w == "forusing":
            i = fresh("turn")
            lines += ["%slet %s = 0;" % (pad, i), "%sfor (using %s = %s; %s < 2; %s++) {" % (pad, fresh("held"), resource(False), i, i)] + inner(in_loop=True) + [pad + "}"]
        elif w == "labeled":
            label = fresh("out")
            lines += ["%s%s: {" % (pad, label)] + inner(labels=tuple(labels) + (label,)) + [pad + "}"]
        elif w == "closure":
            f = fresh("f")
            lines += ["%sconst %s = (): string => {" % (pad, f)] + block(depth - 1, indent + 1, False) + ['%s  return "%s";' % (pad, f), pad + "};", "%slog.push(%s());" % (pad, f)]
        elif w == "switch":
            lines += ["%sswitch (x as number) {" % pad, "%s  case 0: {" % pad] + block(depth - 1, indent + 2, is_async, in_loop, labels, in_generator) + ["%s    break;" % pad, "%s  }" % pad, "%s  default: {" % pad] + block(depth - 1, indent + 2, is_async, in_loop, labels, in_generator) + ["%s  }" % pad, pad + "}"]
        elif w == "stack":
            s = fresh("stack")
            kind = "AsyncDisposableStack" if is_async and chance(0.5) else "DisposableStack"
            keyword = "await using" if kind.startswith("Async") else "using"
            lines.append("%s%s %s = new %s();" % (pad, R.choice([keyword, keyword, "const"]), s, kind))
            for _ in range(R.randint(1, 4)):
                name = fresh("s")
                lines.append(pad + R.choice([
                    '%s.use(%s);' % (s, resource(kind.startswith("Async"))),
                    '%s.defer(() => { log.push("deferred %s"); });' % (s, name),
                    '%s.defer(() => { log.push("deferred %s"); throw new Error("deferred %s"); });' % (s, name, name),
                    '%s.adopt("%s", value => { log.push("adopted " + value); });' % (s, name),
                    'log.push("disposed " + %s.disposed);' % s,
                    ('await %s.disposeAsync();' if kind.startswith("Async") else '%s.dispose();') % s,
                    '{ %s moved = %s.move(); log.push("moved " + %s.disposed + " " + moved.disposed); }' % (keyword, s, s),
                ]))
    return lines


out = [PRELUDE]
rows = []
for index in range(R.randint(8, 18)):
    kind = R.choice(["plain"] * 5 + ["async"] * 4 + ["generator"] * 2 + ["method", "async generator"])
    name = fresh("run")
    if kind == "plain":
        out += ["function %s(x: number): string {" % name] + block(3, 1, False) + ['  return "end";', "}"]
    elif kind == "method":
        out += ["class Holder%s {" % name, "  held = new Resource(\"field %s\");" % name, "  run(x: number): string {"] + block(2, 2, False) + ['    return "end " + this.held.name;', "  }", "}", "const %s = (x: number): string => new Holder%s().run(x);" % (name, name)]
    elif kind == "async":
        out += ["async function %s(x: number): Promise<string> {" % name] + block(3, 1, True) + ['  return "end";', "}"]
    elif kind == "generator":
        g = fresh("gen")
        out += ["function* %s(x: number): Generator<string, void, unknown> {" % g] + block(3, 1, False, in_generator=True) + ["}"]
        out += ["function %s(x: number): string {" % name, "  const seen: string[] = [];", "  for (const each of %s(x)) {" % g, "    seen.push(each);", "    if (seen.length >= %s) break;" % R.choice(["1", "2", "9"]), "  }", '  return seen.join("+");', "}"]
    else:
        g = fresh("gen")
        out += ["async function* %s(x: number): AsyncGenerator<string, void, unknown> {" % g] + block(3, 1, True, in_generator=True) + ["}"]
        out += ["async function %s(x: number): Promise<string> {" % name, "  const seen: string[] = [];", "  for await (const each of %s(x)) {" % g, "    seen.push(each);", "    if (seen.length >= %s) break;" % R.choice(["1", "2", "9"]), "  }", '  return seen.join("+");', "}"]
    rows.append((name, kind in ("async", "async generator")))
for name, is_async in rows:
    for x in R.sample(range(4), R.randint(1, 4)):
        out.append('%s("%s(%d)", () => %s(%d));' % ("await sayLater" if is_async else "say", name, x, name, x))
together = [name for name, is_async in rows if is_async]
if len(together) > 1:
    out.append("await Promise.all([%s]);" % ", ".join('sayLater("together %s", () => %s(%d))' % (name, name, R.randint(0, 3)) for name in together))
if chance(0.5):
    out.append('using atTheTop = new Resource("top");')
    out.append('log.push("the module ends");')
    out.append("queueMicrotaskLog();")
    out.insert(1, 'function queueMicrotaskLog(): void { void Promise.resolve().then(() => console.log("afterwards: " + log.splice(0).join(", "))); }')
out.append("export {};")
print("\n".join(out))
