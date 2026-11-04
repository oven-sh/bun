const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error)); } };
const log: string[] = []; const told = () => { const all = log.join(); log.length = 0; return all; };
function copy(items: any) { return Array.from(items); }
function copyOf(name: string) { return Array.from(box[name]); }
const make = () => new Map<string, number>([["a", 1], ["b", 2]]);
class Other { length = 0; [index: number]: unknown; constructor(...given: unknown[]) { log.push("Other(" + given.length + ")"); } }
class Below extends Array<unknown> {}
function Plain(this: any) { log.push("Plain"); }
const show = (made: any) => [Object.getPrototypeOf(made).constructor.name, made.length, JSON.stringify(Array.prototype.slice.call(made))].join(" ");
for (let turn = 0; turn < 3; turn++) {
  say(Array.from(make(), ([key, value]) => key + value), Array.from(make().entries(), ([key, value], index) => key + value + index), Array.from(make(), function (this: any, pair) { return this.mark + pair[0]; }, { mark: "!" }), Array.from(make(), pair => pair).length);
  say(Array.from(make(), undefined), Array.from(make(), undefined, { ignored: true }));
  attempt("the second argument is no function:", () => Array.from(make(), 5 as any)); attempt("null:", () => Array.from(make(), null as any));
  say(show(Array.from.call(Other, make())), told(), show(Array.from.call(Other, make().entries())), told(), show(Array.from.call(Below, make())), show(Below.from(make())), show(Below.from(make().entries())), show(Array.from.call(Plain, make())), told());
  say(show(Array.from.call(undefined, make())), show(Array.from.call(null, make())), show(Array.from.call(5, make())), show(Array.from.call({}, make())), show(Array.from.call(() => {}, make())), show(Array.from.call(Array, make())), show(Array.from.call(Math.max, make().entries())));
  const from = Array.from; say(show(from(make())), show((0, Array.from)(make().entries()))); const bound = Array.from.bind(Other); say(show(bound(make())), told());
  attempt("a constructor that gives no object to write to:", () => show(Array.from.call(function () { return Object.freeze({}); }, make())));
  say(show(Reflect.apply(Array.from, Array, [make()])), show(Array.from.apply(Array, [make().entries()])), [make(), make().entries()].map(items => Array.from(items).length));
}
