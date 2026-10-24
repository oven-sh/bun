// What goes into Array.from, a typed array from, Iterator.from, for await over a synchronous iterable and the functions of Promise comes out as the object that went in.
const rows = [];
function say(label, value) { rows.push(label + ": " + value); }
function one(n) { return n + 1; }
function two(n) { return n + 2; }
class Point { constructor(x) { this.x = x; } }

// Array.from, with and without a map function, over every kind of source
const fromArray = Array.from([new Point(1), new Point(2)]);
say("from array", fromArray[1].x + " " + fromArray.length);
const fromSet = Array.from(new Set([one, two]));
say("from set", fromSet[1](1));
const fromMap = Array.from(new Map([["k", new Point(3)]]));
say("from map", fromMap[0][0] + fromMap[0][1].x);
const fromString = Array.from("ab");
say("from string", fromString[1].toUpperCase());
const fromLike = Array.from({ length: 2, 0: new Point(4), 1: new Point(5) });
say("from array-like", fromLike[1].x);
const fromHoles = Array.from([, new Point(6)]);
say("from holes", fromHoles[0] + " " + fromHoles[1].x);
function* gen() { yield new Point(7); yield new Point(8); }
say("from generator", Array.from(gen())[1].x);
say("from iterator object", Array.from({ [Symbol.iterator]() { let i = 0; return { next: () => ({ done: i++ > 1, value: new Point(i) }) }; } }).map(p => p.x).join());
class Mine extends Array {}
const mine = Mine.from([new Point(9)]);
say("subclass from", (mine instanceof Mine) + " " + mine[0].x);
say("from with this", Array.from.call(function (n) { this.made = n; }, [1, 2]).made + "");
say("from mapped", Array.from([1, 2], v => new Point(v))[1].x);

// typed arrays
const bytes = Uint8Array.from([1, 2, 300]);
say("typed from", bytes[2] + " " + bytes.length);
say("typed from set", Float64Array.from(new Set([1.5, 2.5]))[1]);
say("typed from typed", Int16Array.from(bytes)[1]);
say("typed from like", Uint8Array.from({ length: 2, 0: 7, 1: 8 })[1]);
say("typed from mapped", Uint8Array.from([1, 2], v => v * 2)[1]);
say("typed from objects", Uint8Array.from([{ valueOf() { return 5; } }])[0]);

// Iterator.from: a wrapper around an iterator that is no Iterator
const wrapped = Iterator.from({ next() { return { done: false, value: new Point(10) }; }, return() { return { done: true, value: "closed" }; } });
const step = wrapped.next();
say("wrapped next", typeof step + " " + step.done + " " + step.value.x);
say("wrapped return", wrapped.return().value);
say("wrapped take", wrapped.take(2).toArray().map(p => p.x).join());
say("from an Iterator", Iterator.from([one, two].values()).next().value(1));
say("from a string", Iterator.from("xy").toArray().join());

// for await over a synchronous iterable
async function overSync() {
  let text = "";
  for await (const p of [new Point(11), Promise.resolve(new Point(12))]) text += p.x + ",";
  for await (const f of new Set([one, two])) text += f(1) + ",";
  for await (const p of gen()) text += p.x + ",";
  return text;
}
say("for await over sync", await overSync());
async function* delegating() { yield* [new Point(13), new Point(14)]; yield* gen(); }
let delegated = "";
for await (const p of delegating()) delegated += p.x + ",";
say("yield* of sync in async generator", delegated);

// promises
say("resolve", (await Promise.resolve(new Point(15))).x);
say("resolve thenable", (await Promise.resolve({ then(r) { r(new Point(16)); } })).x);
say("all", (await Promise.all([new Point(17), Promise.resolve(new Point(18))]))[1].x);
say("allSettled", (await Promise.allSettled([Promise.reject(new Point(19)), new Point(20)])).map(r => r.status + (r.value ?? r.reason).x).join());
say("race", (await Promise.race([new Point(21)])).x);
say("any", (await Promise.any([Promise.reject(1), new Point(22)])).x);
say("then chain", await Promise.resolve(one).then(f => f(1)).then(n => two(n)));
say("finally", (await Promise.resolve(new Point(23)).finally(() => new Point(0))).x);
say("withResolvers", await (() => { const { promise, resolve } = Promise.withResolvers(); resolve(new Point(24)); return promise.then(p => p.x); })());
say("try", (await Promise.try(() => new Point(25))).x);
say("fromAsync", (await Array.fromAsync([Promise.resolve(new Point(26))]))[0].x);
console.log(rows.join("\n"));
