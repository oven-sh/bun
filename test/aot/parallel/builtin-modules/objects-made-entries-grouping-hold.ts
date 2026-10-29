// Object.fromEntries and Object.groupBy answer ordinary objects that hold what they were handed: functions and objects of the program come out as what they are.
const say = (...values: unknown[]) => console.log(...values);
class Body { constructor(public mass: number) {} weight() { return this.mass * 2; } }
const made = Object.fromEntries([["run", () => "a function of the program"], ["body", new Body(2)], ["n", 1]] as [string, any][]);
say(made.run(), made.body.weight(), made.body instanceof Body, made.n, made.nothing, Object.keys(made).join(), Object.getPrototypeOf(made) === Object.prototype, typeof made.toString);
say(made); say(JSON.stringify(Object.fromEntries(new Map([["a", 1], ["b", 2]]))), Object.fromEntries(new URLSearchParams("x=1&y=2")).y);
const own = Object.fromEntries([["__proto__", { inherited: true }]]); say(Object.getPrototypeOf(own) === Object.prototype, Object.keys(own).join(), (own as any).inherited);
const symbol = Symbol("key"); say(Object.fromEntries([[symbol, "under a symbol"], [{ toString() { say("the key is converted"); return "converted"; } } as any, 1]])[symbol as any], Object.fromEntries([[1, "index"]])[1]);
function* entries() { say("the generator ran"); yield ["g", () => "from a generator"] as const; } say(Object.fromEntries(entries()).g());
made.later = () => "stored later"; say(made.later(), delete made.n, made.n);
const groups = Object.groupBy([new Body(1), new Body(2), new Body(3)], (body, index) => { say("callback", body.mass, index); return body.mass % 2 ? "odd" : "even"; });
say(Object.getPrototypeOf(groups), Object.keys(groups).join(), groups.odd!.length, groups.odd![1].weight(), groups.even![0] instanceof Body, (groups as any).none, Array.isArray(groups.even));
say(groups); groups.odd!.push(new Body(5)); say(groups.odd!.map(body => body.weight()).join());
say(Object.keys(Object.groupBy("abca", letter => letter)).join(), Object.groupBy([1], () => ({ toString() { say("the group's key is converted"); return "k"; } }) as any).k);
for (const wrong of [() => Object.fromEntries(undefined as any), () => Object.fromEntries([1] as any), () => Object.fromEntries(1 as any), () => Object.groupBy(null as any, () => 1), () => Object.groupBy([1], 1 as any), () => Object.groupBy([1], () => { throw new RangeError("from the callback"); }), () => Object.fromEntries({ [Symbol.iterator]() { throw new EvalError("from the iterator"); } } as any)])
  try { say(wrong()); } catch (e) { say((e as Error).name); }
