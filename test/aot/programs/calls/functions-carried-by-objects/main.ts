// Functions are stored in objects, arrays, maps, promises and class instances, typed and untyped, and taken out again by every way the language has. Whoever follows them through the program must find each one where it is called.
import { untyped, JsPlugin, changePlugin } from "./untyped.js";

type Step = (n: number) => number;
const log: string[] = [];
const say = (what: string, value: unknown) => log.push(what + "=" + String(value));

const plusOne: Step = n => n + 1;
const double: Step = n => n * 2;
const square: Step = n => n * n;
const negate: Step = n => -n;
const half: Step = n => n / 2;

interface Holder { step: Step; label: string }
function run(holder: Holder, n: number) { return holder.step(n); }

const first: Holder = { step: plusOne, label: "first" };
say("literal", run(first, 1));

const loose: any = first;
loose.step = double;
say("stored through any", run(first, 5));

const key = ["st", "ep"].join("");
loose[key] = square;
say("stored by a computed key", run(first, 5));

Object.assign(first, { step: negate });
say("Object.assign", run(first, 5));

Object.defineProperty(first, "step", { value: half, writable: true, configurable: true, enumerable: true });
say("defineProperty", run(first, 5));

Reflect.set(first, "step", plusOne);
say("Reflect.set", run(first, 5));

let times = 0;
const second: Holder = { step: plusOne, label: "second" };
Object.defineProperty(second, "step", { get() { times++; return times % 2 ? double : square; }, configurable: true });
say("accessor", run(second, 3) + "," + run(second, 3));

const copy = { ...first, step: square };
say("spread", run(copy, 4) + "," + run(first, 4));

const { step: taken, ...others } = copy;
say("rest", taken(3) + "," + Object.keys(others).join());

class Counter {
  step: Step = plusOne;
  by(n: number) { return this.step(n); }
}
const counter = new Counter();
say("field of a class", counter.by(1));
(counter as any).step = double;
say("field of a class, stored through any", counter.by(4));

const list: Step[] = [plusOne];
const useAll = (steps: Step[], n: number) => steps.reduce((sum, step) => sum + step(n), 0);
say("array", useAll(list, 2));
list.push(double);
say("push", useAll(list, 2));
list[0] = square;
say("element stored", useAll(list, 3));
(list as any).unshift(negate);
say("unshift through any", useAll(list, 3));
list.splice(1, 1, half);
say("splice", useAll(list, 4));
list.length = 1;
say("length", useAll(list, 4));
const more = list.concat([double], square);
say("concat", useAll(more, 3));
say("map", useAll(more.map(step => (n: number) => step(n) + 1), 3));
say("filter", useAll(more.filter(step => step !== double), 3));
say("from", useAll(Array.from(more), 3) + "," + useAll(Array.from(new Set(more)), 3) + "," + useAll([...more].reverse(), 3));
say("sort", more.slice().sort((a, b) => a(2) - b(2)).map(step => step(2)).join());
say("find", more.find(step => step(2) === 4)!(5));
say("at", more.at(-1)!(5));
say("flat", useAll([[plusOne], [double, [square] as any]].flat(2) as Step[], 3));
say("entries", [...more.entries()].map(([i, step]) => i + ":" + step(2)).join());
say("fill", useAll(new Array<Step>(2).fill(half), 8));
say("of", useAll(Array.of(plusOne, negate), 8));

const table = new Map<string, Step>([["a", plusOne]]);
table.set("b", double);
say("map get", table.get("a")!(1) + "," + table.get("b")!(2));
table.set("a", square);
say("map set again", table.get("a")!(3));
let sum = 0;
table.forEach(step => { sum += step(3); });
say("map forEach", sum);
say("map values", [...table.values()].map(step => step(2)).join());
say("map entries", [...table].map(([name, step]) => name + step(2)).join());
const byStep = new Map<Step, Step>([[plusOne, double]]);
say("map keys", [...byStep.keys()][0]!(1) + "," + byStep.get(plusOne)!(4));
const bag = new Set<Step>([plusOne]);
bag.add(negate);
say("set", [...bag].map(step => step(2)).join());
const weak = new WeakMap<object, Step>();
weak.set(first, square);
say("weak map", weak.get(first)!(6));

say("call", run.call(null, { step: double, label: "" }, 3));
say("apply", run.apply(null, [{ step: square, label: "" }, 3]));
say("bind", run.bind(null, { step: negate, label: "" })(3));
say("Reflect.apply", Reflect.apply(run, null, [{ step: half, label: "" }, 3]));

const proxied = new Proxy(first, { get(target, name, receiver) { return name === "step" ? square : Reflect.get(target, name, receiver); } });
say("proxy", run(proxied, 7));

const inherited: Holder = Object.create({ step: double, label: "proto" });
say("inherited", run(inherited, 7));
Object.setPrototypeOf(inherited, { step: negate, label: "other" });
say("another prototype", run(inherited, 7));

const parsed = JSON.parse('{"label":"parsed"}') as Holder;
parsed.step = plusOne;
say("parsed", run(parsed, 7));

const frozen = Object.freeze({ step: double, label: "frozen" });
try { (frozen as any).step = square; } catch (error) { say("frozen throws", (error as Error).constructor.name); }
say("frozen", run(frozen, 7));

delete (copy as any).step;
try { say("deleted", run(copy, 1)); } catch (error) { say("deleted throws", (error as Error).constructor.name); }

async function later(step: Step) { return { step, label: "later" }; }
const thenable = { then(resolve: (holder: Holder) => void) { resolve({ step: negate, label: "thenable" }); } };
const settled = await Promise.all([later(plusOne), later(double), thenable as unknown as Promise<Holder>, Promise.resolve({ step: square, label: "" })]);
say("await", settled.map(holder => run(holder, 3)).join());
say("then", await later(half).then(holder => run(holder, 3)));
say("then of then", await later(half).then(holder => later(holder.step)).then(holder => run(holder, 5)));
say("race", run(await Promise.race([later(square)]), 3));

function* each(): Generator<Holder, void, Step> {
  let step: Step = plusOne;
  for (;;) step = yield { step, label: "yielded" };
}
const made = each();
say("generator", run(made.next().value as Holder, 1) + "," + run(made.next(double).value as Holder, 2) + "," + run(made.next(square).value as Holder, 3));

try { throw { step: negate, label: "thrown" }; } catch (caught) { say("caught", run(caught as Holder, 2)); }

const symbol = Symbol("step");
const keyed: any = { [symbol]: plusOne };
keyed[symbol] = double;
say("symbol", keyed[symbol](4));

const nested = { inner: { deeper: { step: plusOne, label: "" } } };
const reach = (o: typeof nested) => o.inner.deeper.step(3);
say("nested", reach(nested));
(nested.inner as any).deeper = { step: double, label: "" };
say("nested replaced", reach(nested));

interface Kit { readonly tools: Holder; step: Step }
const toolsOfKit: Holder = { step: double, label: "tools" };
const kit: Kit = { get tools() { return toolsOfKit; }, step: plusOne };
say("getter of a record", kit.tools.step(2) + "," + kit.step(2));
(kit.tools as any).step = square;
say("stored through what a getter yields", kit.tools.step(3) + "," + run(toolsOfKit, 3));
Object.defineProperty(kit, "extra", { value: double });
say("defineProperty of another name", kit.step(2) + "," + (kit as any).extra(2));
const holders: Holder[] = [{ step: plusOne, label: "a" }, { step: double, label: "b" }];
function eachHolder<T>(items: readonly T[], visit: (item: T) => number) { let total = 0; for (const item of items) total += visit(item); return total; }
say("a typed list through a generic helper", eachHolder(holders, holder => holder.step(3)));
(holders as any[]).push({ step: square, label: "plain" });
say("a plain object pushed into a typed list", eachHolder(holders, holder => holder.step(3)) + "," + holders.map(holder => run(holder, 2)).join());
(holders as any[])[0].step = negate;
say("stored through an element of any", run(holders[0]!, 3));
const fromText = JSON.parse('[{"label":"text"}]') as Holder[];
fromText[0]!.step = half;
say("a list from a text", run(fromText[0]!, 3));
interface Plugin { act: Step; name: string }
function usePlugin(plugin: Plugin, n: number) { return plugin.act(n); }
const ownPlugin: Plugin = { act: plusOne, name: "own" };
const jsPlugin: Plugin = new JsPlugin(square);
say("an object of a class of JavaScript beside one of the program", usePlugin(ownPlugin, 4) + "," + usePlugin(jsPlugin, 4));
jsPlugin.act = double;
ownPlugin.act = negate;
say("stored through the type to both", usePlugin(ownPlugin, 4) + "," + usePlugin(jsPlugin, 4));
changePlugin(ownPlugin, half);
changePlugin(jsPlugin, plusOne);
say("stored by JavaScript to both", usePlugin(ownPlugin, 4) + "," + usePlugin(jsPlugin, 4) + "," + ownPlugin.act(8));
delete (ownPlugin as any).act;
(ownPlugin as any).act = square;
say("deleted and put back", usePlugin(ownPlugin, 4) + "," + ownPlugin.act(5));
const makeHolder = (step: Step): Holder => ({ step, label: "made" });
say("untyped", untyped({ plusOne, double, square, negate, half, run, makeHolder }).join(";"));
console.log(log.join("\n"));
