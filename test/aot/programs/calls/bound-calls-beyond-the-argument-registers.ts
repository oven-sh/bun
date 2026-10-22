// Calls of bound functions whose bound and passed arguments together do not fit in registers, that have more bound arguments than the function object holds itself, or that were renamed, extended or frozen.
// Results, stack traces, exceptions, collections, tail calls, coroutines and deep recursion are those of plain Bun.
const letters = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
let kept: unknown[] = [];

function frames(error: unknown): string {
  const list: string[] = [];
  let sawProgramFrame = false;
  for (const line of String((error as Error).stack).split("\n")) {
    const frame = /^\s*at (?:new )?(.*?) \((.*)\)$/.exec(line);
    if (!frame) continue;
    const [, name, location] = frame;
    if (name.startsWith("<parse>")) continue;
    const isNative = location === "unknown" || location === "[native code]" || location.startsWith("native");
    if (!isNative) sawProgramFrame = true;
    else if (sawProgramFrame) continue;
    list.push(isNative ? name + " (native)" : name + ":" + (/:(\d+):\d+$/.exec(location)?.[1] ?? location));
    if (name === "root") break;
  }
  return list.join(" < ");
}

function told(result: unknown): string {
  return result instanceof Error ? result.constructor.name + " " + result.message + " @ " + frames(result) : String(result);
}

function bind(target: any, thisArgument: unknown, count: number): any {
  return target.bind(thisArgument, ...letters.slice(0, count).map(letter => letter.toUpperCase()));
}

function call(f: any, count: number): unknown {
  let result: unknown;
  switch (count) {
    case 0: result = f(); break;
    case 1: result = f("a"); break;
    case 2: result = f("a", "b"); break;
    case 3: result = f("a", "b", "c"); break;
    case 4: result = f("a", "b", "c", "d"); break;
    case 5: result = f("a", "b", "c", "d", "e"); break;
    case 6: result = f("a", "b", "c", "d", "e", "f"); break;
    case 7: result = f("a", "b", "c", "d", "e", "f", "g"); break;
    case 8: result = f("a", "b", "c", "d", "e", "f", "g", "h"); break;
    case 9: result = f("a", "b", "c", "d", "e", "f", "g", "h", "i"); break;
    case 10: result = f("a", "b", "c", "d", "e", "f", "g", "h", "i", "j"); break;
    default: result = f(...letters.slice(0, count)); break;
  }
  kept.push(result);
  return result;
}

function root(f: any, count: number): unknown {
  try {
    const result = call(f, count);
    kept.push(result);
    return result;
  } catch (error) {
    return error;
  }
}

const rest: any = function rest(this: unknown, ...list: unknown[]) { return String(this) + "/" + list.length + ":" + list.join(""); };
const thrower: any = function thrower(this: unknown, ...list: unknown[]) { throw new Error(String(this) + "/" + list.length + ":" + list.join("")); };
const fixed: any = function fixed(this: unknown, a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any, k: any, l: any) { return [this, a, b, c, d, e, f, g, h, i, j, k, l].map(String).join("."); };

const boundCounts = [0, 1, 2, 3, 4, 5, 8, 9, 12];
const passedCounts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
for (const bound of boundCounts) {
  for (const passed of passedCounts) console.log("thrown", bound, passed, told(root(bind(thrower, "T", bound), passed)));
  console.log("fixed", bound, passedCounts.map(passed => root(bind(fixed, "T", bound), passed)).join(" "));
}

const changes: [string, (f: any) => void][] = [
  ["renamed", f => { Object.defineProperty(f, "name", { value: "renamed" }); }],
  ["a property", f => { f.extra = 1; }],
  ["name and length read", f => { kept.push(f.name, f.length); }],
  ["another prototype", f => { Object.setPrototypeOf(f, { inherited: true }); }],
  ["no prototype", f => { Object.setPrototypeOf(f, null); }],
  ["frozen", f => { Object.freeze(f); }],
  ["a hundred properties", f => { for (let i = 0; i < 100; i++) f["p" + i] = i; }],
  ["properties deleted", f => { f.extra = 1; delete f.extra; delete f.name; delete f.length; }],
];
const targets: [string, any, unknown][] = [
  ["rest", rest, "T"],
  ["thrower", thrower, "T"],
  ["concat", String.prototype.concat, "T"],
  ["parse", JSON.parse, JSON],
  ["call", Function.prototype.call, rest],
  ["call of thrower", Function.prototype.call, thrower],
  ["bound", bind(rest, "inner", 2), "T"],
  ["bound to five", bind(thrower, "inner", 5), "T"],
];
for (const [change, apply] of changes) {
  for (const [name, target, thisArgument] of targets) {
    for (const bound of [0, 1, 3, 4, 6]) {
      const f = bind(target, thisArgument, bound);
      apply(f);
      console.log(change, "|", name, bound, "|", [0, 1, 2, 4, 5, 9, 10, 12].map(passed => told(root(f, passed))).join(" ; "));
    }
  }
}

function survives(f: any, seed: number): string {
  let a = seed + 1, b = seed * 2, c = "s" + seed, d = [seed], e = { seed }, g = seed / 3, h = seed - 7, i = "t" + seed;
  for (let round = 0; round < 3; round++) {
    try {
      const result = f(a, b, c, d, e, g, h, i, round);
      kept.push(result);
      c += "!";
    } catch (error: any) {
      c += error.message.length;
      a++;
    }
  }
  return [a, b, c, d[0], e.seed, g, h, i].join();
}
for (const bound of [0, 1, 3, 4, 9]) console.log("survives", bound, survives(bind(thrower, "T", bound), bound + 5), survives(bind(rest, "T", bound), bound + 5));

const collects: any = function collects(this: any, ...list: any[]) {
  kept = [];
  Bun.gc(true);
  const garbage = Array.from({ length: 1000 }, (_, n) => ({ n }));
  Bun.gc(true);
  return garbage.length + "/" + this.n + ":" + list.map(object => object.n).join();
};
function fresh(n: number): { n: number } { return { n }; }
function collecting(bound: number): unknown {
  const result = collects.bind(fresh(0), ...Array.from({ length: bound }, (_, n) => fresh(n + 1)))(fresh(100), fresh(101), fresh(102), fresh(103), fresh(104), fresh(105), fresh(106), fresh(107), fresh(108));
  return result;
}
for (const bound of [0, 1, 3, 4, 5, 9, 40]) console.log("collects", bound, collecting(bound));

const restBoundToFour = bind(rest, "four", 4);
const throwerBoundToFour = bind(thrower, "four", 4);
const forwards: any = function forwards(this: unknown, a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any) { return rest(j, i, h, g, f, e, d, c, b, a, "more", "and more"); };
const forwardsList: any = function forwardsList(this: unknown, ...list: unknown[]) { return rest(...list, "last"); };
const forwardsToBound: any = function forwardsToBound(this: unknown, a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any) { return restBoundToFour(j, i, h, g, f, e, d, c, b, a); };
const forwardsListToBound: any = function forwardsListToBound(this: unknown, ...list: unknown[]) { return throwerBoundToFour(...list); };
for (const forwarder of [forwards, forwardsList, forwardsToBound, forwardsListToBound]) {
  for (const bound of [0, 2, 4, 7]) console.log("tail call", forwarder.name, bound, [0, 3, 6, 10, 12].map(passed => told(root(bind(forwarder, "T", bound), passed))).join(" ; "));
}

let depth = 0;
const holder: any = {};
const descends: any = function descends(this: any, a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any) { depth++; return 1 + this.again(f, g, h, i, j); };
function overflows(bound: number): string {
  holder.again = bind(descends, holder, bound);
  depth = 0;
  try {
    return "returned " + holder.again(6, 7, 8, 9, 10);
  } catch (error: any) {
    return error.constructor.name + " " + (depth > 100);
  }
}
for (const bound of [0, 3, 5, 9]) console.log("recursion", bound, overflows(bound), overflows(bound), root(bind(rest, "T", bound), 9));

for (const length of [100, 4000, 4090, 4093, 4094, 4200, 20000]) {
  const list = new Array(length).fill(7);
  const afterThree: any = bind(function (this: unknown, ...all: any[]) { return [this, all.length, all[0], all[2], all[3], all[all.length - 1]].join(); }, "T", 3);
  const afterFive: any = bind(function (this: unknown, ...all: any[]) { return [this, all.length, all[0], all[4], all[5], all[all.length - 1]].join(); }, "T", 5);
  console.log("long list", length, afterThree(...list), afterFive(...list), afterThree.apply(null, list), Reflect.apply(afterFive, null, list));
}

const later: any = async function later(this: unknown, a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any, k: any, l: any) {
  const before = [this, a, b, c, d, e, f].map(String).join("");
  await null;
  return before + "|" + [g, h, i, j, k, l].map(String).join("");
};
const rejects: any = async function rejects(this: unknown, ...list: unknown[]) { await null; throw new Error(String(this) + list.join("")); };
const each: any = function* each(this: unknown, ...list: unknown[]) { yield String(this); yield* list; };
for (const bound of [0, 1, 3, 4, 9]) {
  for (const passed of [0, 1, 5, 9, 12]) {
    const rejection = await (root(bind(rejects, "T", bound), passed) as Promise<unknown>).then(String, (error: Error) => "rejected " + error.message);
    console.log("coroutines", bound, passed, await root(bind(later, "T", bound), passed), rejection, [...(root(bind(each, "T", bound), passed) as Iterable<unknown>)].join(""));
  }
}
export {};
