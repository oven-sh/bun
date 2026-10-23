// "Parameter cb is only called, with an object made here" is composed at each call site with the closure that stands there. The composition is wrong where the helper does not call what it was passed as it came in, where it calls it in another way than a plain call, or where what stands at the site is no plain closure.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface Temp {
  n: number;
  tag: string;
}
type Use = (t: Temp) => unknown;
const kept: Temp[] = [];
const keeper: Use = t => kept.push(t);
const reader: Use = t => t.n;
const temp = (n: number, how: string): Temp => ({ n, tag: how + n });
const rare = (n: number) => n % 90 === 89;

// The parameter is stored to before the call.
function replacesItsParameter(n: number, use: Use): unknown {
  if (rare(n)) use = keeper;
  return use(temp(n, "replaced parameter "));
}
// A default stands in for a missing callback.
function hasADefault(n: number, use: Use = keeper): unknown {
  return use(temp(n, "default "));
}
// One of two.
function choosesBetween(n: number, first: Use, second: Use): unknown {
  return (rare(n) ? second : first)(temp(n, "chosen "));
}
// The callback goes through a field, an array, a variable of a closure.
function throughAField(n: number, use: Use): unknown {
  const holder = { use };
  return holder.use(temp(n, "through a field "));
}
function throughAList(n: number, use: Use): unknown {
  return [reader, use][1](temp(n, "through a list "));
}
function throughAClosure(n: number, use: Use): unknown {
  const call = (t: Temp) => use(t);
  return call(temp(n, "through a closure "));
}
// Called in other ways.
function byCall(n: number, use: Use): unknown {
  return use.call(null, temp(n, "by call "));
}
function byApply(n: number, use: Use): unknown {
  return use.apply(null, [temp(n, "by apply ")]);
}
function byReflect(n: number, use: Use): unknown {
  return Reflect.apply(use, null, [temp(n, "by Reflect ")]);
}
function asThis(n: number, use: (this: Temp) => unknown): unknown {
  return use.call(temp(n, "as this "));
}
function byABuiltIn(n: number, use: Use): unknown {
  return [temp(n, "by forEach ")].forEach(use);
}
function withMore(n: number, use: (...all: Temp[]) => unknown): unknown {
  return use(temp(n, "first of three "), temp(n, "second of three "), temp(n, "third of three "));
}
function constructed(n: number, Use: new (t: Temp) => unknown): unknown {
  return new Use(temp(n, "constructed with "));
}
function later(n: number, use: Use): void {
  const t = temp(n, "later ");
  queueMicrotask(() => use(t));
}
// The answer of the callback is the answer of the helper.
function answers(n: number, use: (t: Temp) => Temp | number): Temp | number {
  return use(temp(n, "answered "));
}
// The callback is handed on.
function handsOn(n: number, use: Use): unknown {
  return throughAClosure(n, use);
}
let sum = 0;
function run(): void {
  const local: Temp[] = [];
  for (let i = 0; i < 270; i++) {
    const keep = rare(i);
    sum += replacesItsParameter(i, reader) as number;
    sum += (keep ? hasADefault(i) : hasADefault(i, reader)) as number;
    sum += choosesBetween(i, reader, keeper) as number;
    const mine: Use = keep ? t => local.push(t) : t => t.n;
    for (const helper of [throughAField, throughAList, throughAClosure, byCall, byApply, byReflect, handsOn]) sum += helper(i, mine) as number;
    byABuiltIn(i, mine);
    asThis(i, function (this: Temp) {
      if (keep) local.push(this);
      return this.n;
    });
    withMore(i, (...all) => {
      if (keep) local.push(all[2]);
    });
    withMore(i, function () {
      if (keep) local.push(arguments[1]);
    });
    constructed(
      i,
      class {
        constructor(t: Temp) {
          if (keep) local.push(t);
        }
      },
    );
    later(i, t => {
      if (keep) local.push(t);
    });
    const answer = answers(i, keep ? t => t : t => t.n);
    if (typeof answer === "object") local.push(answer);
  }
  console.log(sum, churn(60));
  console.log(kept.map(t => t.tag).join(" | "));
  console.log(local.map(t => t.tag).join(" | "));
  queueMicrotask(() => console.log(churn(20), local.slice(-3).map(t => t.tag).join(" | ")));
}
run();
await null;

// What stands at the site is no plain closure.
kept.length = 0;
const coroutines: Promise<string>[] = [];
const generators: Generator<string>[] = [];
function withTemp(n: number, use: Use): unknown {
  return use(temp(n, "for a site "));
}
const bound = keeper.bind(null);
const proxied = new Proxy(reader, {
  apply(target, self, args: [Temp]) {
    kept.push(args[0]);
    return target(args[0]);
  },
});
const set = new Set<Temp>();
class Sink {
  items: Temp[] = [];
  take = (t: Temp) => this.items.push(t);
  method(t: Temp) {
    return this.items.push(t);
  }
}
const sink = new Sink();
for (let i = 0; i < 100; i++) {
  withTemp(i, reader);
  if (i % 45 !== 44) continue;
  withTemp(i, bound);
  withTemp(i, proxied);
  withTemp(i, set.add.bind(set));
  withTemp(i, sink.take);
  withTemp(i, sink.method.bind(sink));
  withTemp(i, async t => {
    coroutines.push(Promise.resolve().then(() => "in a reaction " + t.tag));
    await null;
    kept.push(t);
  });
  withTemp(i, t => {
    generators.push(
      (function* () {
        yield "in a generator " + t.tag;
      })(),
    );
  });
  withTemp(i, ({ tag }) => kept.push({ n: -1, tag: "only its tag: " + tag }));
  withTemp(i, (t, extra = kept.push(t)) => extra);
  withTemp(i, Array.prototype.push.bind(kept) as Use);
  withTemp(i, Object.freeze);
  withTemp(i, JSON.stringify as Use);
}
churn(60);
await null;
await null;
console.log(kept.map(t => t.tag).join(" | "));
console.log([...set].map(t => t.tag).join(), sink.items.map(t => t.tag).join(), (await Promise.all(coroutines)).join(), generators.map(g => g.next().value).join());
