// which functions a stack trace made inside a generator's body names, for each way of stepping the generator
const lines: string[] = [];
function namesIn(stack: string | undefined): string {
  const names: string[] = [];
  for (const line of (stack ?? "").split("\n")) {
    if (line.endsWith("@[native code]")) continue;
    const found = /^\s*at (?:async )?(?:([^\s(]+) \()?/.exec(line) ?? /^([^@]*)@/.exec(line);
    if (!found) continue;
    const name = found[1] ?? "";
    if (name === "" || name === "module code" || name === "global code") break;
    names.push(name);
  }
  return names.join(" < ");
}
function* body(): Generator<string, void, unknown> {
  yield namesIn(new Error("in the body").stack);
  yield namesIn(new Error("in the body").stack);
}
function* throws(): Generator<string, void, unknown> {
  throw new Error("thrown in the body");
}
function* guarded(): Generator<string, string, unknown> {
  try {
    yield "first";
    return "not reached";
  } catch (error) {
    return "caught: " + namesIn(new Error("in catch").stack);
  } finally {
    lines.push("finally: " + namesIn(new Error("in finally").stack));
  }
}
const kept: any[] = [];
function keep<T>(value: T): T {
  kept.push(value);
  return kept.pop();
}
function byName(iterator: any): unknown {
  return iterator.next().value;
}
function declared(generator: Generator<string, unknown, unknown>): unknown {
  return generator.next().value;
}
function loop(values: Iterable<string>): unknown {
  for (const value of values) return value;
}
function pattern(values: Iterable<string>): unknown {
  const [first] = values;
  return first;
}
function* delegates(inner: Iterable<string>): Generator<string, void, unknown> {
  yield* inner;
}
function spread(values: Iterable<string>): unknown {
  return [...values][0];
}
function returnsByName(iterator: any): unknown {
  iterator.next();
  return iterator.return("asked").value;
}
function throwsByName(iterator: any): unknown {
  iterator.next();
  return iterator.throw(new Error("thrown in")).value;
}
function returnsDeclared(generator: Generator<string, string, unknown>): unknown {
  generator.next();
  return generator.return("asked").value;
}
function throwsDeclared(generator: Generator<string, string, unknown>): unknown {
  generator.next();
  return generator.throw(new Error("thrown in")).value;
}
const ways: [string, (x: any) => unknown][] = [
  ["by name", byName],
  ["declared", declared],
  ["for..of", loop],
  ["pattern", pattern],
  ["spread", spread],
];
for (const [title, run] of ways) lines.push(`${title}: ${run(keep(body()))}`);
lines.push(`yield*, by name: ${byName(keep(delegates(keep(body()))))}`);
lines.push(`yield*, for..of: ${loop(keep(delegates(keep(body()))))}`);
for (const [title, run] of ways) {
  try {
    run(keep(throws()));
  } catch (error) {
    lines.push(`thrown, ${title}: ${namesIn((error as Error).stack)}`);
  }
}
lines.push(`return() by name: ${returnsByName(keep(guarded()))}`);
lines.push(`throw() by name: ${throwsByName(keep(guarded()))}`);
lines.push(`return() declared: ${returnsDeclared(keep(guarded()))}`);
lines.push(`throw() declared: ${throwsDeclared(keep(guarded()))}`);
console.log(lines.join("\n"));
