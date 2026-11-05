// An exception crosses compiled code, eval code, a function created from text and a native function on one stack: the right handler gets it, every finally block runs once and in order, locals survive, async functions reject and generators finish.
const lines: string[] = [];
const nativeNames = ["replace", "parse", "from", "stringify"];
let log: string[] = [];
let catcher = "";
let overriding = "";
let replacing = "";
let raise: () => unknown = () => undefined;
let thrown: { value: unknown } | undefined;
let bomb = "none";
function describe(value: unknown): string {
  if (value instanceof Error) return value.constructor.name + (value.message.startsWith("own ") ? ":" + value.message : "");
  if (value === undefined || value === null || typeof value === "symbol") return String(value);
  if (Object.is(value, -0)) return "-0";
  return typeof value + ":" + String(value);
}
function describeArrival(value: unknown): string {
  if (!thrown) return describe(value);
  return describe(value) + (Object.is(value, thrown.value) ? " (what was thrown)" : " (not what was thrown)");
}
const hooks = { log: (text: string) => { log.push(text); }, describe, catcher: () => catcher };

function leaf(seed: number): number {
  const a = seed + 1, b = seed * 3 + 2, c = seed * 0.5 + 0.25, d = "leaf" + seed, e = { v: seed * 7 }, f = [seed, a];
  try { const result: any = raise(); return result + a; }
  catch (error) {
    log.push("leaf catch " + describe(error));
    if (replacing === "leaf") throw new RangeError("own replaced in leaf");
    if (catcher !== "leaf") throw error;
    return a + b;
  } finally {
    log.push("leaf finally " + [a, b, c, d, e.v, f.join("+")].join(" "));
    if (overriding === "leaf") return -a;
  }
}
const evalLevel = "try { leaf(seed + 1) + 1 } catch (error) { log.push('eval catch ' + describe(error)); if (catcher !== 'eval') throw error; -1 } finally { log.push('eval finally ' + seed) }";
function inner(seed: number): number {
  const a = seed + 1, b = seed * 3 + 2, c = seed * 0.5 + 0.25, d = "inner" + seed, e = { v: seed * 7 }, f = [seed, a];
  try { const result = eval(evalLevel); return result + a; }
  catch (error) {
    log.push("inner catch " + describe(error));
    if (replacing === "inner") throw new RangeError("own replaced in inner");
    if (catcher !== "inner") throw error;
    return a + b;
  } finally {
    log.push("inner finally " + [a, b, c, d, e.v, f.join("+")].join(" "));
    if (overriding === "inner") return -a;
  }
}
const textMiddle = new Function("hooks", `return function textMiddle(callee, seed) {
  var saved = seed * 11;
  try { var result = callee(seed + 1); return result + 1; }
  catch (error) { hooks.log("text catch " + hooks.describe(error)); if (hooks.catcher() !== "text") throw error; return saved; }
  finally { hooks.log("text finally " + saved); }
};`)(hooks);
function middle(seed: number): number {
  const a = seed + 1, b = seed * 3 + 2, c = seed * 0.5 + 0.25, d = "middle" + seed, e = { v: seed * 7 }, f = [seed, a];
  try { const result = textMiddle(inner, seed + 1); return result + a; }
  catch (error) {
    log.push("middle catch " + describe(error));
    if (replacing === "middle") throw new RangeError("own replaced in middle");
    if (catcher !== "middle") throw error;
    return a + b;
  } finally {
    log.push("middle finally " + [a, b, c, d, e.v, f.join("+")].join(" "));
    if (overriding === "middle") return -a;
  }
}
function viaNative(digits: string): string {
  const seed = Number(digits);
  const a = seed + 1, b = seed * 3 + 2, c = seed * 0.5 + 0.25, d = "viaNative" + seed, e = { v: seed * 7 }, f = [seed, a];
  try { const result = middle(seed + 1); return String(result + a); }
  catch (error) {
    log.push("viaNative catch " + describe(error));
    if (replacing === "viaNative") throw new RangeError("own replaced in viaNative");
    if (catcher !== "viaNative") throw error;
    return String(a + b);
  } finally {
    log.push("viaNative finally " + [a, b, c, d, e.v, f.join("+")].join(" "));
    if (overriding === "viaNative") return String(-a);
  }
}
function outermost(seed: number): string {
  const a = seed + 1, b = seed * 3 + 2, c = seed * 0.5 + 0.25, d = "outermost" + seed, e = { v: seed * 7 }, f = [seed, a];
  try { const subject: any = String(seed + 1); const result = subject[nativeNames[0]](/\d+/g, viaNative); return String(result + a); }
  catch (error) {
    log.push("outermost catch " + describe(error));
    if (replacing === "outermost") throw new RangeError("own replaced in outermost");
    if (catcher !== "outermost") throw error;
    return String(a + b);
  } finally {
    log.push("outermost finally " + [a, b, c, d, e.v, f.join("+")].join(" "));
    if (overriding === "outermost") return String(-a);
  }
}
function ground(seed: number): string {
  const a = seed + 1, b = seed * 3 + 2, c = seed * 0.5 + 0.25, d = "ground" + seed, e = { v: seed * 7 }, f = [seed, a];
  try { const result = outermost(seed + 1); return String(result + a); }
  catch (error) {
    log.push("ground catch " + describe(error));
    if (replacing === "ground") throw new RangeError("own replaced in ground");
    if (catcher !== "ground") throw error;
    return String(a + b);
  } finally {
    log.push("ground finally " + [a, b, c, d, e.v, f.join("+")].join(" "));
    if (overriding === "ground") return String(-a);
  }
}

function throwOwn(create: () => unknown): () => unknown {
  return () => {
    const value = create();
    thrown = { value };
    throw value;
  };
}
const raiseError = throwOwn(() => new RangeError("own compiled"));
const raiseFromNative = (): unknown => { const result = (JSON as any)[nativeNames[1]]("{"); return result; };
const ownValues: unknown[] = [undefined, null, 0, -0, "", "text", 12n, Symbol.for("thrown"), Object.freeze({ frozen: true })];
const otherRaisers: [string, () => unknown][] = [
  ...ownValues.map((value): [string, () => unknown] => [describe(value), throwOwn(() => value)]),
  ["an error thrown by a native function", raiseFromNative],
  ["a property read on undefined", () => { const result = (undefined as any).missing; return result; }],
  ["an error thrown by text", new Function("throw new EvalError('own text');") as () => unknown],
  ["an error thrown by a getter under a native function", () => { const result = JSON.stringify({ get bad() { throw new RangeError("own getter"); } }); return result; }],
];
const caughtBy = (level: string): string => ", caught by " + (level || "nobody");
function start(): void {
  log = [];
  thrown = undefined;
}
function finish(label: string, outcome: string): string {
  return label + ": " + outcome + (log.length ? " | " + log.join(" ; ") : "");
}
function attempt(label: string): string {
  start();
  let outcome: string;
  try {
    outcome = "returned " + ground(1);
  } catch (error) {
    outcome = "escaped " + describeArrival(error);
  }
  return finish(label, outcome);
}
function record(label: string, run: () => unknown): void {
  start();
  let outcome: string;
  try {
    const result = run();
    outcome = typeof result === "string" ? result : JSON.stringify(result);
  } catch (error) {
    outcome = "caught " + describeArrival(error);
  }
  lines.push(finish(label, outcome));
}
function runMatrix(): void {
  const compiledLevels = ["leaf", "inner", "middle", "viaNative", "outermost", "ground"];
  raise = raiseError;
  for (const level of ["leaf", "eval", "inner", "text", "middle", "viaNative", "outermost", "ground", ""]) {
    catcher = level;
    const label = "a RangeError" + caughtBy(level);
    const first = attempt(label), second = attempt(label), third = attempt(label);
    lines.push(first, second === first && third === first ? "  three times the same" : "  then " + second + "\n  then " + third);
  }
  for (const [label, raiser] of otherRaisers) {
    raise = raiser;
    for (const level of ["leaf", "text", "outermost", ""]) {
      catcher = level;
      lines.push(attempt(label + caughtBy(level)));
    }
  }
  raise = raiseError;
  catcher = "";
  for (const level of compiledLevels) {
    overriding = level;
    lines.push(attempt("return in the finally block of " + level));
  }
  overriding = "";
  catcher = "ground";
  for (const level of compiledLevels) {
    replacing = level;
    lines.push(attempt("replaced in " + level));
  }
  replacing = "";
  catcher = "";
}

async function asyncLeaf(when: string): Promise<number> {
  if (when === "before") raise();
  await null;
  raise();
  return 1;
}
const textAsync = new Function("hooks", "return async function textAsync(callee, when) { try { return (await callee(when)) + 1; } finally { hooks.log('textAsync finally'); } };")(hooks);
async function asyncMiddle(when: string): Promise<number> {
  const seed = when.length;
  const a = seed + 1, b = seed * 3 + 2, c = seed * 0.5 + 0.25, d = "asyncMiddle" + seed, e = { v: seed * 7 }, f = [seed, a];
  try { const result = await textAsync(asyncLeaf, when); return result + a; }
  catch (error) {
    log.push("asyncMiddle catch " + describe(error));
    if (replacing === "asyncMiddle") throw new RangeError("own replaced in asyncMiddle");
    if (catcher !== "asyncMiddle") throw error;
    return a + b;
  } finally {
    log.push("asyncMiddle finally " + [a, b, c, d, e.v, f.join("+")].join(" "));
    if (overriding === "asyncMiddle") return -a;
  }
}
async function asyncOverChain(): Promise<string> {
  const result = ground(1);
  return result;
}
let stored: Promise<unknown> | undefined;
function storePromise(when: string): string {
  stored = asyncLeaf(when);
  return "";
}
const callFromText = new Function("f", "try { return ['returned', f('before')]; } catch (error) { return ['threw']; }");
const earlyCallers: [string, () => any[]][] = [
  ["compiled code", () => { try { const promise = asyncLeaf("before"); return ["returned", promise]; } catch { return ["threw"]; } }],
  ["text", () => { const answer = callFromText(asyncLeaf); return answer; }],
  ["a callback of a native function", () => { const subject: any = "before"; try { subject[nativeNames[0]](/before/g, storePromise); return ["returned", stored]; } catch { return ["threw"]; } }],
  ["Array.from", () => { try { const list = (Array as any)[nativeNames[2]](["before"], asyncLeaf); return ["returned", list[0]]; } catch { return ["threw"]; } }],
];
function settle(label: string, promise: Promise<unknown>): Promise<void> {
  return promise.then(
    value => { lines.push(finish(label, "fulfilled " + describe(value))); },
    error => { lines.push(finish(label, "rejected " + describeArrival(error))); },
  );
}
async function runAsyncFunctions(): Promise<void> {
  const raisers: [string, () => unknown][] = [["a RangeError", raiseError], ["undefined", throwOwn(() => undefined)], ["an error thrown by a native function", raiseFromNative]];
  for (const [label, raiser] of raisers) {
    raise = raiser;
    for (const when of ["before", "after"]) {
      for (const level of ["asyncMiddle", ""]) {
        catcher = level;
        start();
        await settle(label + " " + when + " the first await" + caughtBy(level), asyncMiddle(when));
      }
    }
  }
  raise = raiseError;
  overriding = "asyncMiddle";
  start();
  await settle("return in the finally block of asyncMiddle", asyncMiddle("after"));
  overriding = "";
  replacing = "asyncMiddle";
  start();
  await settle("replaced in asyncMiddle", asyncMiddle("after"));
  replacing = "";
  for (const [label, call] of earlyCallers) {
    start();
    const [said, promise] = call();
    await settle("a throw before the first await, called by " + label + " (the call " + said + ")", Promise.resolve(promise));
  }
  start();
  await settle("an async function over the chain", asyncOverChain());
}

function* steps(seed: number): Generator<any> {
  log.push("steps start");
  try {
    yield seed;
    yield ground(seed);
    yield -1;
  } finally {
    log.push("steps finally");
  }
}
function* bareSteps(seed: number): Generator<any> {
  log.push("bareSteps start");
  yield seed;
  yield ground(seed);
  yield -1;
}
const textSteps = new Function("hooks", "return function* textSteps() { try { yield 1; yield 2; } finally { hooks.log('textSteps finally'); } };")(hooks);
let running: Generator<any>;
function* resumesItself(): Generator<any> {
  yield running.next();
}
function driveByHand(it: Generator<any>): string {
  const seen = [JSON.stringify(it.next())];
  try {
    seen.push(JSON.stringify(it.next()));
  } catch (error) {
    seen.push("caught " + describeArrival(error));
  }
  seen.push(JSON.stringify(it.next()), JSON.stringify(it.next()));
  return seen.join(" ");
}
const driveFromText = new Function("it", "var seen = []; try { for (var v of it) seen.push(v); } catch (error) { seen.push('caught'); } seen.push(JSON.stringify(it.next())); return seen;");
function driveFromNative(it: Generator<any>, consume: (it: Generator<any>) => void): string {
  let outcome = "finished";
  try {
    consume(it);
  } catch (error) {
    outcome = "caught " + describeArrival(error);
  }
  return outcome + " " + JSON.stringify(it.next());
}
function throwInLoop(items: Iterable<any>): string {
  try {
    for (const value of items) throw new RangeError("own loop " + value);
  } catch (error) {
    log.push("loop catch " + describe(error));
  }
  return "left the loop";
}
function runGenerators(): void {
  raise = raiseError;
  catcher = "";
  for (const create of [steps, bareSteps]) {
    record(create.name + " by hand", () => driveByHand(create(1)));
    record(create.name + " from text", () => driveFromText(create(1)).join(" "));
    record(create.name + " under new Set", () => driveFromNative(create(1), it => { Reflect.construct(Set, [it]); }));
    record(create.name + " under Array.from", () => driveFromNative(create(1), it => { (Array as any)[nativeNames[2]](it); }));
  }
  const resumers: [string, any][] = [
    ["throw from compiled code", (it: Generator<any>) => { const result = it.throw(new RangeError("own injected")); return result; }],
    ["return from compiled code", (it: Generator<any>) => { const result = it.return(9); return result; }],
    ["throw from text", new Function("it", "var result = it.throw(new RangeError('own injected')); return result;")],
    ["return from text", new Function("it", "var result = it.return(9); return result;")],
  ];
  for (const [label, resume] of resumers) {
    const it = steps(1);
    it.next();
    record(label + " into steps at its first yield", () => { const result = resume(it); return result; });
    lines.push("  then " + JSON.stringify(it.next()));
  }
  record("a throw in a loop over steps", () => throwInLoop(steps(1)));
  record("a throw in a loop over textSteps", () => throwInLoop(textSteps()));
  running = resumesItself();
  record("a generator that resumes itself", () => { const result = running.next(); return result; });
  lines.push("  then " + JSON.stringify(running.next()));
}

class Tree {
  constructor(public name: string, public child: unknown) {}
  toJSON(): unknown {
    if (this.name === bomb) raise();
    return { name: this.name, child: this.child };
  }
}
function revive(key: string, value: unknown): unknown {
  if (key === bomb) raise();
  return value;
}
function runJSON(): void {
  const tree = new Tree("a", new Tree("b", new Tree("c", null)));
  const text = '{"a":{"b":{"c":1}}}';
  const calls: [string, () => unknown][] = [
    ["JSON.stringify", () => { const result = JSON.stringify(tree); return result; }],
    ["stringify by name", () => { const result = (JSON as any)[nativeNames[3]](tree); return result; }],
    ["JSON.parse", () => { const result = JSON.parse(text, revive); return result; }],
    ["parse by name", () => { const result = (JSON as any)[nativeNames[1]](text, revive); return result; }],
  ];
  raise = raiseError;
  for (const [label, call] of calls) {
    for (const target of ["c", "none", "none"]) {
      bomb = target;
      record(label + ", bomb at " + target, call);
    }
  }
}

async function main(): Promise<void> {
  runMatrix();
  await runAsyncFunctions();
  runGenerators();
  runJSON();
  console.log(lines.join("\n"));
}
main();
export {};
