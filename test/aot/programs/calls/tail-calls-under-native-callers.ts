// A function that native code calls (a JSON reviver, a sort comparator, a promise job, a timer, a proxy trap ..) ends in a tail call, so no compiled frame is left between the native caller and the callee, whatever kind of callee that is.
declare const console: any, setTimeout: any;
const plain: any = function (x: any) { return "plain " + String(x); };
const callees: [string, any][] = [
  ["function", plain], ["arrow", (x: any) => "arrow " + String(x)], ["proxy", new Proxy(plain, {})], ["proxy of a proxy", new Proxy(new Proxy(plain, {}), {})],
  ["proxy with a trap", new Proxy(plain, { apply(t: any, _: any, a: any[]) { return "trapped " + t(...a); } })], ["bound", plain.bind(null)], ["bound with an argument", plain.bind(null, "b")],
  ["bound proxy", new Proxy(plain, {}).bind(null)], ["host", Math.abs], ["String", String], ["Number", Number], ["Boolean", Boolean], ["Object", Object], ["Array", Array], ["Symbol", (x: any) => String(Symbol(String(x)))],
  ["Error", (x: any) => String(Error(String(x)))], ["class", class K { }], ["async", async (x: any) => x], ["generator", function* (x: any) { yield x; }], ["rest", (...a: any[]) => "rest " + a.length],
  ["arguments", function () { return "arguments " + arguments.length; }], ["six parameters", (a: any, b: any, c: any, d: any, e: any, f: any) => "six " + String(a) + String(f)], ["object", {}], ["undefined", undefined], ["number", 7],
];
function show(v: any): string { return typeof v === "object" && v !== null ? Object.prototype.toString.call(v) : String(v); }
function attempt(f: () => any): string { try { return show(f()); } catch (e: any) { return "threw " + e.constructor.name; } }
const later: Promise<string>[] = [];
for (const [name, callee] of callees) {
  const one: any = function (x: any) { return callee(x); };
  const two: any = function (a: any, b: any) { return callee(a, b); };
  const many: any = function (a: any) { return callee(a, 1, 2, 3, 4, 5, 6, 7, 8, 9); };
  const spread: any = function (...a: any[]) { return callee(...a); };
  const applied: any = function () { return callee.apply(undefined, arguments); };
  const line = [
    attempt(() => JSON.parse("[1]", function (k: any, v: any) { return k === "0" ? show(callee(v)) : v; })[0]),
    attempt(() => { let r: any; JSON.parse("1", function (_: any, v: any) { r = attempt(() => one(v)); return v; }); return r; }),
    attempt(() => { let seen: any; try { JSON.parse("1", one); seen = "returned"; } catch (e: any) { seen = "threw " + e.constructor.name; } return seen; }),
    attempt(() => { try { JSON.parse("1", many); return "returned"; } catch (e: any) { return "threw " + e.constructor.name; } }),
    attempt(() => { try { JSON.parse("1", spread); return "returned"; } catch (e: any) { return "threw " + e.constructor.name; } }),
    attempt(() => { try { JSON.parse("1", applied); return "returned"; } catch (e: any) { return "threw " + e.constructor.name; } }),
    attempt(() => Reflect.apply(one, undefined, [2])),
    attempt(() => Reflect.apply(many, undefined, [2])),
    attempt(() => Reflect.apply(spread, undefined, [2, 3, 4, 5, 6, 7])),
    attempt(() => "x".replace("x", one).length > 0),
    attempt(() => Array.from([3], one)[0]),
    attempt(() => Array.from({ length: 1, 0: 4 } as any, two)[0]),
    attempt(() => { try { [2, 1].sort(two); return "sorted"; } catch (e: any) { return "threw " + e.constructor.name; } }),
    attempt(() => (new Proxy({}, { get: two } as any) as any).key),
    attempt(() => { try { return String({ [Symbol.toPrimitive]: one }).length >= 0; } catch (e: any) { return "threw " + e.constructor.name; } }),
    attempt(() => { try { return JSON.stringify({ toJSON: one }) !== ""; } catch (e: any) { return "threw " + e.constructor.name; } }),
  ];
  console.log(name + ": " + line.join(" | "));
  later.push(Promise.resolve(5).then(one).then(show, (e: any) => "rejected " + e.constructor.name).then(s => name + " in a promise job: " + s));
  later.push(new Promise<string>(resolve => { setTimeout(function () { resolve(name + " in a timer: fired"); try { } catch { } return typeof callee === "function" && name !== "class" ? callee(7) : undefined; }, 0); }));
}
Promise.all(later).then(lines => console.log(lines.join("\n")));
export {};
