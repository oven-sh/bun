// array literal throws
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  const list = [];
  attempt(() => { list[0] = [1, mayThrow(), 3]; });
  console.log("array-literal-throws", list.length, typeof list[0]);
  await 0;
})();

// assigned after throw number
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  let state;
  function init() { hook = () => state + 1; mayThrow(); state = 41; }
  attempt(init);
  console.log("assigned-after-throw-number", attempt(hook));
  await 0;
})();

// assigned after throw
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  let state;
  function init() { hook = () => state.x; mayThrow(); state = { x: 1 }; }
  attempt(init);
  console.log("assigned-after-throw", attempt(hook));
  await 0;
})();

// async suspended for ever
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  async function init() { hook = () => v.x; await new Promise(() => {}); const v = { x: 1 }; return v; }
  init();
  console.log("async-suspended-for-ever", attempt(hook));
  await 0;
})();

// async throws midway
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  async function init() { hook = () => v.x; await 0; mayThrow(); const v = { x: 1 }; return v; }
  init().catch(() => console.log("async-throws-midway", attempt(hook)));
  console.log("async-throws-midway", attempt(hook));
  await 0;
})();

// async two suspended activations
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  const made = [];
  async function work(n) { let c = n * 10; await 0; made[made.length] = () => ++c; }
  const jobs = [1, 2];
  const started = []; for (const n of jobs) started[started.length] = work(n);
  await Promise.all(started);
  console.log("async-two-suspended-activations", made.length, made[0](), made[1]());
  await 0;
})();

// class after throw in function
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  function init() { hook = () => new K().m(); mayThrow(); class K { m() { return 1; } } return K; }
  attempt(init);
  console.log("class-after-throw-in-function", attempt(hook));
  await 0;
})();

// class heritage throws
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  function init() { hook = () => new K(); class K extends mayThrow() {} return K; }
  attempt(init);
  console.log("class-heritage-throws", attempt(hook));
  await 0;
})();

// computed key throws
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  function init() { hook = () => new K(); class K { [mayThrow()]() {} } return K; }
  attempt(init);
  console.log("computed-key-throws", attempt(hook));
  await 0;
})();

// const after throw in function
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  function init() { hook = () => v.x; mayThrow(); const v = { x: 1 }; return v; }
  attempt(init);
  console.log("const-after-throw-in-function", attempt(hook));
  await 0;
})();

// constructor throws after leak
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  let leak;
  class C { constructor() { leak = this; this.a = 1; mayThrow(); this.b = { x: 1 }; } }
  attempt(() => new C());
  console.log("constructor-throws-after-leak", leak.a, attempt(() => leak.b.x), "b" in leak, Object.keys(leak).join());
  await 0;
})();

// destructuring throws midway
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  let a = 1, b = { x: 1 };
  attempt(() => { [a, b] = { [Symbol.iterator]() { let n = 0; return { next() { if (n++) mayThrow(); return { value: "s", done: false }; } }; } }; });
  console.log("destructuring-throws-midway", typeof a, typeof b, b.x);
  await 0;
})();

// field initializer throws after base leak
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  let leak;
  class B { constructor() { leak = this; } }
  class C extends B { a = 1; t = mayThrow(); b = { x: 1 }; }
  attempt(() => new C());
  console.log("field-initializer-throws-after-base-leak", leak.a, attempt(() => leak.b.x), "b" in leak, Object.keys(leak).join(), leak instanceof C);
  await 0;
})();

// finally overrides throw
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  function init() { try { hook = () => v.x; mayThrow(); } finally { return "finally"; } const v = { x: 1 }; }
  console.log("finally-overrides-throw", init(), attempt(hook));
  await 0;
})();

// function value after throw
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  function init() { hook = () => f(); mayThrow(); const f = () => 1; return f; }
  attempt(init);
  console.log("function-value-after-throw", attempt(hook));
  await 0;
})();

// generator never started
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  function* init() { const v = { x: 1 }; hook = () => v.x; yield v; }
  const it = init();
  console.log("generator-never-started", typeof hook);
  await 0;
})();

// generator suspended
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  function* init() { hook = () => v.x; yield 1; const v = { x: 1 }; yield v; }
  const it = init();
  for (const first of it) { console.log("generator-suspended", attempt(hook)); break; }
  console.log("generator-suspended", attempt(hook));
  await 0;
})();

// generator two suspended activations
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  function* g(n) { let c = n * 10; yield () => ++c; }
  const fs = []; for (const n of [1, 2]) for (const f of g(n)) { fs[fs.length] = f; }
  console.log("generator-two-suspended-activations", fs[0](), fs[1](), fs[0]());
  await 0;
})();

// hoisted function before class
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  console.log("hoisted-function-before-class", attempt(use));
  class K { static s = 1; }
  function use() { return K.s; }
  console.log("hoisted-function-before-class", attempt(use));
  await 0;
})();

// hoisted function before const
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  console.log("hoisted-function-before-const", attempt(use));
  const later = { x: 1 };
  function use() { return later.x; }
  console.log("hoisted-function-before-const", attempt(use));
  await 0;
})();

// let after throw in function
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  function init() { hook = () => v.x; mayThrow(); let v = { x: 1 }; return v; }
  attempt(init);
  console.log("let-after-throw-in-function", attempt(hook));
  await 0;
})();

// literal member throws
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  let seen;
  const o = attempt(() => ({ a: 1, get self() { return 1; }, b: mayThrow(), c: 2 }));
  console.log("literal-member-throws", o);
  await 0;
})();

// loop closure dead zone
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  const hooks = [];
  for (let i = 0; i < 2; i++) { hooks[i] = () => v.x + i; if (i === 1) continue; const v = { x: 10 }; }
  console.log("loop-closure-dead-zone", attempt(hooks[0]), attempt(hooks[1]));
  await 0;
})();

// module const after caught throw
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  hook = () => later.x;
  try { mayThrow(); } catch (e) { console.log("module-const-after-caught-throw", attempt(hook)); }
  const later = { x: 1 };
  console.log("module-const-after-caught-throw", attempt(hook));
  await 0;
})();

// number after throw in function
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  function init() { hook = () => v + 1; mayThrow(); const v = 41; return v; }
  attempt(init);
  console.log("number-after-throw-in-function", attempt(hook));
  await 0;
})();

// object destructuring throws midway
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  let a = 1, b = { x: 1 };
  attempt(() => { ({ a, b } = { a: "s", get b() { return mayThrow(); } }); });
  console.log("object-destructuring-throws-midway", typeof a, typeof b, b.x);
  await 0;
})();

// once function entered again after throw
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  let tries = 0; const made = [];
  function init() { let c = 0; made[made.length] = () => ++c; if (++tries === 1) throw new RangeError("first"); return c; }
  for (const i of [0, 1]) attempt(init);
  made[0](); made[0]();
  console.log("once-function-entered-again-after-throw", made.length, made[1]());
  await 0;
})();

// private field after throw
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  let leak;
  class B { constructor() { leak = this; } }
  class C extends B { t = mayThrow(); #p = { x: 1 }; static read(o) { return o.#p.x; } static has(o) { return #p in o; } }
  attempt(() => new C());
  console.log("private-field-after-throw", attempt(() => C.read(leak)), C.has(leak));
  await 0;
})();

// private method after throw
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  let leak;
  class B { constructor() { leak = this; mayThrow(); } }
  class C extends B { #m() { return 1; } static call(o) { return o.#m(); } }
  attempt(() => new C());
  console.log("private-method-after-throw", attempt(() => C.call(leak)));
  await 0;
})();

// reaction registered before const
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  Promise.resolve().then(() => console.log("reaction-registered-before-const", attempt(() => later.x)));
  const later = { x: 1 };
  await 0;
})();

// retry by recursion after throw
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  let tries = 0; const made = [];
  function init() { let c = 0; made[made.length] = () => ++c; if (++tries === 1) throw new RangeError("first"); return c; }
  function start() { try { return init(); } catch (e) { return start(); } }
  start();
  made[0](); made[0]();
  console.log("retry-by-recursion-after-throw", made.length, made[1]());
  await 0;
})();

// retry in catch second site
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  let tries = 0; const made = [];
  function init() { let c = 0; made[made.length] = () => ++c; if (++tries === 1) throw new RangeError("first"); return c; }
  try { init(); } catch (e) { init(); }
  made[0](); made[0]();
  console.log("retry-in-catch-second-site", made.length, made[1]());
  await 0;
})();

// singleton retry
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  let instance, tries = 0;
  function get() { if (instance) return instance; const fresh = { n: ++tries, parts: [] }; fresh.parts[0] = tries; if (tries === 1) throw new RangeError("first"); instance = fresh; return instance; }
  console.log("singleton-retry", attempt(get), attempt(() => get().n), get() === get(), get().parts.length);
  await 0;
})();

// static block reads outer const
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  const K = class { static x = attempt(() => K); };
  console.log("static-block-reads-outer-const", K.x);
  await 0;
})();

// static field throws after leak
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  let leak;
  attempt(() => { class K { static a = (leak = K, 1); static t = mayThrow(); static b = { x: 1 }; static m() { return K.b.x; } } });
  console.log("static-field-throws-after-leak", leak.a, attempt(() => leak.b.x), attempt(() => leak.m()), "b" in leak);
  await 0;
})();

// static field throws
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  let K;
  attempt(() => { K = class { static a = 1; static t = mayThrow(); static b = { x: 1 }; }; });
  console.log("static-field-throws", typeof K);
  await 0;
})();

// stored once in throwing function
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  const o = { a: 1 };
  function fill() { mayThrow(); o.late = { x: 1 }; }
  attempt(fill);
  console.log("stored-once-in-throwing-function", attempt(() => o.late.x), "late" in o);
  await 0;
})();

// stored once read before
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  const o = { a: 1 };
  function read() { return o.late; }
  console.log("stored-once-read-before", read());
  o.late = { x: 1 };
  console.log("stored-once-read-before", read().x);
  await 0;
})();

// super throws this unset
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  class B { constructor() { mayThrow(); } }
  class C extends B { constructor() { try { super(); } catch (e) { } hook = () => this; console.log("super-throws-this-unset", attempt(hook)); return { replaced: 1 }; } }
  console.log("super-throws-this-unset", attempt(() => new C().replaced));
  await 0;
})();

// switch case dead zone
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  function s(n) { switch (n) { case 0: hook = () => v.x; break; case 1: const v = { x: 1 }; hook = () => v.x; } return attempt(hook); }
  console.log("switch-case-dead-zone", s(0), s(1));
  await 0;
})();

// two live activations getter
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  const made = []; let depth = 0;
  const o = { get x() { let c = depth * 10; made[made.length] = () => ++c; if (depth++ === 0) this.x; return c; } };
  o.x;
  console.log("two-live-activations-getter", made.length, made[0](), made[1]());
  await 0;
})();

// two live activations
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  const made = []; let depth = 0;
  function outer(cb) { let c = depth * 10; made[made.length] = () => ++c; depth++; if (cb) cb(); return c; }
  const again = [outer];
  outer(() => again[0](null));
  console.log("two-live-activations", made.length, made[0](), made[1]());
  await 0;
})();

// typeof in dead zone
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  console.log("typeof-in-dead-zone", attempt(() => typeof later));
  const later = { x: 1 };
  await 0;
})();

// var after throw in function
await (async () => {
  function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
  function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
  let hook;
  function init() { hook = () => v.x; mayThrow(); var v = { x: 1 }; return v; }
  attempt(init);
  console.log("var-after-throw-in-function", attempt(hook));
  await 0;
})();
