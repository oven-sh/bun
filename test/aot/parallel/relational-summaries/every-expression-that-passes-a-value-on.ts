// Whoever walks a function to see where a parameter goes must know every form of expression and statement that hands a value on unchanged. One function a form: each answers its parameter, by that form alone; on one call in ninety the answer is kept. Fresh objects go in, identity and contents are checked when their makers are gone.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface P {
  tag: string;
}
const other: P = { tag: "the other" };
let scratch: P | null = null;
const holder: { f: P | null; g: P | null } = { f: null, g: null };
const yes = () => true;
const none = (): P | null => null;
const forms: [string, (p: P) => P][] = [
  ["parentheses", p => (p)],
  ["as", p => p as P],
  ["angle brackets", p => <P>p],
  ["non-null", p => p!],
  ["satisfies", p => p satisfies P],
  ["as unknown as", p => p as unknown as P],
  ["conditional, first", p => (yes() ? p : other)],
  ["conditional, second", p => (!yes() ? other : p)],
  ["or", p => none() || p],
  ["or, left", p => p || other],
  ["and", p => (yes() && p) as P],
  ["coalesce", p => none() ?? p],
  ["coalesce, left", p => p ?? other],
  ["comma", p => (void 0, p)],
  ["assignment", p => (scratch = p)],
  ["chained assignment", p => (holder.f = holder.g = p)],
  ["logical assignment", p => ((scratch = null), (scratch ||= p))],
  ["coalescing assignment", p => ((scratch = null), (scratch ??= p))],
  ["and assignment", p => ((scratch = other), (scratch &&= p))],
  ["member assignment", p => ((holder.f = p), holder.f)],
  ["object pattern", p => {
    const { a } = { a: p };
    return a;
  }],
  ["renamed in a pattern", p => {
    const { a: b } = { a: p };
    return b;
  }],
  ["nested pattern", p => {
    const { a: { b: [c] } } = { a: { b: [p] } };
    return c;
  }],
  ["default in a pattern", p => {
    const { a = p } = {} as { a?: P };
    return a;
  }],
  ["array pattern", p => {
    const [a] = [p];
    return a;
  }],
  ["rest in an array pattern", p => {
    const [, ...rest] = [other, p];
    return rest[0];
  }],
  ["rest in an object pattern", p => {
    const { x, ...rest } = { x: 1, a: p };
    return rest.a;
  }],
  ["pattern assignment", p => {
    let a: P;
    [a] = [p];
    return a;
  }],
  ["object pattern assignment", p => {
    let a: P;
    ({ a } = { a: p });
    return a;
  }],
  ["swap", p => {
    let a = other;
    let b = p;
    [a, b] = [b, a];
    return a;
  }],
  ["array spread", p => [...[p]][0]],
  ["object spread", p => ({ ...{ a: p } }).a],
  ["argument spread", p => ((x: P) => x)(...([p] as [P]))],
  ["constructor spread", p => new (class { constructor(public x: P) {} })(...([p] as [P])).x],
  ["tagged template", p => ((strings: TemplateStringsArray, x: P) => x)`a${p}b`],
  ["for-of", p => {
    for (const x of [p]) return x;
    return other;
  }],
  ["for-of over a set", p => {
    for (const x of new Set([p])) return x;
    return other;
  }],
  ["for-of with a pattern", p => {
    for (const [, x] of new Map([[1, p]])) return x;
    return other;
  }],
  ["for-in and a key", p => {
    const o = { k: p };
    for (const k in o) return o[k as "k"];
    return other;
  }],
  ["loop variable", p => {
    let x = other;
    for (let i = 0; i < 2; i++) x = i ? p : other;
    return x;
  }],
  ["while with a break", p => {
    let x = other;
    while (true) {
      x = p;
      break;
    }
    return x;
  }],
  ["labeled block", p => {
    let x = other;
    out: {
      x = p;
      if (yes()) break out;
      x = other;
    }
    return x;
  }],
  ["switch", p => {
    let x = other;
    switch (p.tag.length > 0) {
      case true:
        x = p;
    }
    return x;
  }],
  ["throw and catch", p => {
    try {
      throw p;
    } catch (e) {
      return e as P;
    }
  }],
  ["throw in a callee and catch", p => {
    try {
      (() => {
        throw p;
      })();
    } catch (e) {
      return e as P;
    }
    return other;
  }],
  ["finally", p => {
    let x = other;
    try {
      return x;
    } finally {
      x = p;
      if (yes()) return x;
    }
  }],
  ["called at once", p => (() => p)()],
  ["function called at once", p => (function () {
    return p;
  })()],
  ["closure of a closure", p => (() => () => () => p)()()()],
  ["default of a parameter", p => ((x = p) => x)()],
  ["default that names a parameter", p => ((a: P, b = a) => b)(p)],
  ["this", p => (function (this: P) {
    return this;
  }).call(p)],
  ["this of an arrow inside", p => (function (this: P) {
    return (() => this)();
  }).call(p)],
  ["method of a literal", p => ({
    held: p,
    get() {
      return this.held;
    },
  }).get()],
  ["getter of a literal", p => ({
    get x() {
      return p;
    },
  }).x],
  ["setter of a literal", p => {
    let got = other;
    const o = {
      set x(v: P) {
        got = v;
      },
    };
    o.x = p;
    return got;
  }],
  ["class field", p => new (class {
    f = p;
  })().f],
  ["private field", p => new (class {
    #f = p;
    get() {
      return this.#f;
    }
  })().get()],
  ["static field", p => (class {
    static f = p;
  }).f],
  ["static block", p => {
    let got = other;
    class C {
      static {
        got = p;
      }
    }
    void C;
    return got;
  }],
  ["parameter property", p => new (class {
    constructor(public f: P) {}
  })(p).f],
  ["super call", p => new (class extends (class {
    constructor(public f: P) {}
  }) {
    constructor(x: P) {
      super(x);
    }
  })(p).f],
  ["super method", p => new (class extends (class {
    id(x: P) {
      return x;
    }
  }) {
    id(x: P) {
      return super.id(x);
    }
  })().id(p)],
  ["constructor that returns it", p => new (class {
    constructor() {
      return p;
    }
  })() as P],
  ["prototype of a literal", p => Object.getPrototypeOf({ __proto__: p })],
  ["computed key", p => ({ ["a" + "b"]: p }).ab],
  ["optional chain", p => ({ a: { b: p } } as { a?: { b: P } }).a?.b as P],
  ["optional call", p => ((x: P) => x)?.(p)],
  ["optional element", p => ([p] as P[] | undefined)?.[0] as P],
  ["generator's yield", p => (function* () {
    yield p;
  })().next().value as P],
  ["generator's return", p => (function* () {
    return p;
  })().next().value],
  ["yield star", p => (function* () {
    yield* [p];
  })().next().value as P],
  ["sent into a generator", p => {
    const g = (function* (): Generator<undefined, P, P> {
      return yield;
    })();
    g.next();
    return g.next(p).value as P;
  }],
  ["arguments", p => (function (..._: P[]) {
    return arguments[0];
  })(p)],
  ["rest parameter", p => ((...all: P[]) => all[0])(p)],
  ["var above its declaration", p => {
    x = p;
    var x: P;
    return x;
  }],
  ["function declared below", p => {
    return id(p);
    function id(x: P) {
      return x;
    }
  }],
  ["new Object", p => new Object(p) as P],
  ["Object", p => Object(p)],
  ["valueOf", p => p.valueOf() as P],
  ["using", p => {
    using resource = { held: p, [Symbol.dispose]() {} };
    return resource.held;
  }],
];
const kept: P[] = [];
const wanted: P[] = [];
let wrong = "";
for (let round = 0; round < 180; round++) {
  for (let i = 0; i < forms.length; i++) {
    const p: P = { tag: forms[i][0] + " " + round };
    const back = forms[i][1](p);
    if (back !== p) wrong += forms[i][0] + " ";
    if (round % 90 === 89) kept.push(forms[i][1]({ tag: forms[i][0] + ", kept " + round }));
  }
}
scratch = null;
holder.f = holder.g = null;
console.log(forms.length, wrong === "" ? "all came back" : "NOT THE SAME: " + wrong, churn(80));
console.log(kept.map(k => k.tag).join(" | "));

// The same through an await, where the frame is given up in between.
const asyncForms: [string, (p: P) => Promise<P>][] = [
  ["await", async p => await p],
  ["return", async p => p],
  ["await of a promise", async p => await Promise.resolve(p)],
  ["held over an await", async p => {
    await null;
    return p;
  }],
  ["then", p => Promise.resolve(p).then(x => x)],
  ["finally", p => Promise.resolve(p).finally(() => other)],
  ["catch", p => Promise.reject(p).catch(x => x)],
  ["await in a catch", async p => {
    try {
      await Promise.reject(p);
    } catch (e) {
      return e as P;
    }
    return other;
  }],
  ["all", async p => (await Promise.all([p]))[0]],
  ["race", p => Promise.race([p])],
  ["any", p => Promise.any([Promise.reject(other), p])],
  ["allSettled", async p => ((await Promise.allSettled([p]))[0] as PromiseFulfilledResult<P>).value],
  ["for await", async p => {
    for await (const x of [p]) return x;
    return other;
  }],
  ["async generator", async p => (await (async function* () {
    yield p;
  })().next()).value as P],
  ["executor", p => new Promise(resolve => resolve(p))],
  ["timer", p => new Promise(resolve => setTimeout(resolve, 0, p))],
];
const pending: Promise<string>[] = [];
for (let round = 0; round < 20; round++) {
  for (const [name, form] of asyncForms) {
    const p: P = { tag: name + " " + round };
    pending.push(form(p).then(back => (back === p ? back.tag : "NOT THE SAME: " + name)));
  }
}
churn(80);
const tags = await Promise.all(pending);
console.log(tags.filter(t => t.startsWith("NOT")).join(), tags.slice(-asyncForms.length).join(" | "));
