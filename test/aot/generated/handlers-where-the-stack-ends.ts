// Every road by which compiled code can come to the end of the stack, under every kind of handler that the frame may stand in.
// Each function counts itself in, has a way out that calls nothing, goes on by its road and counts itself out in its handler. The error that ends the recursion belongs to the
// handler of the deepest frame that has begun. So behind it the count is zero, whatever the size of a frame: a frame that was passed by shows as a count that is not.
// Handlers that undo by a call of their own (`using`, the return() of an iterator or a generator) are left out: that call may find no room either, also in plain Bun.
const roads: Record<string, { decl?: string; step: string }> = {
  "a call": { step: "ENTER(n + 1)" },
  "a method of two": { decl: "const ms_F = [{ m(x) { return ENTER(x); } }, { m(x) { return x; } }];", step: "ms_F[n < 0 ? 1 : 0].m(n + 1)" },
  "a getter": { decl: "let a_F = 0; const g_F = { get next() { return ENTER(a_F); } };", step: "(a_F = n + 1, g_F.next)" },
  "a setter": { decl: "const s_F = { set next(x) { ENTER(x); } };", step: "(s_F.next = n + 1)" },
  "a get trap": { decl: "let a_F = 0; const p_F = new Proxy({}, { get() { return ENTER(a_F); } });", step: "(a_F = n + 1, p_F.x)" },
  "a set trap": { decl: "const p_F = new Proxy({}, { set(t, k, x) { ENTER(x); return true; } });", step: "(p_F.x = n + 1)" },
  "a has trap": { decl: "let a_F = 0; const p_F = new Proxy({}, { has() { ENTER(a_F); return true; } });", step: "(a_F = n + 1, 'x' in p_F)" },
  "an apply trap": { decl: "const p_F = new Proxy(function () {}, { apply(t, s, l) { return ENTER(l[0]); } });", step: "p_F(n + 1)" },
  "a construct trap": { decl: "const p_F = new Proxy(function () {}, { construct(t, l) { ENTER(l[0]); return {}; } });", step: "new p_F(n + 1)" },
  "a proxy without traps": { decl: "const p_F = new Proxy(x => ENTER(x), {});", step: "p_F(n + 1)" },
  "toString": { decl: "let a_F = 0; const t_F = { toString() { return String(ENTER(a_F)); } };", step: "(a_F = n + 1, `${t_F}`)" },
  "valueOf": { decl: "let a_F = 0; const t_F = { valueOf() { ENTER(a_F); return 1; } };", step: "(a_F = n + 1, +t_F)" },
  "toPrimitive": { decl: "let a_F = 0; const t_F = { [Symbol.toPrimitive]() { ENTER(a_F); return 1; } };", step: "(a_F = n + 1, t_F + 1)" },
  "a computed key": { decl: "let a_F = 0; const t_F = { toString() { ENTER(a_F); return 'k'; } };", step: "(a_F = n + 1, ({})[t_F])" },
  "Symbol.iterator": { decl: "let a_F = 0; const i_F = { [Symbol.iterator]() { ENTER(a_F); return [][Symbol.iterator](); } };", step: "(a_F = n + 1, [...i_F].length)" },
  "an iterator's next": { decl: "let a_F = 0; const i_F = { [Symbol.iterator]() { return { next() { ENTER(a_F); return { done: true }; } }; } };", step: "(a_F = n + 1, [...i_F].length)" },
  "a pattern over an iterator": { decl: "let a_F = 0; const i_F = { [Symbol.iterator]() { return { next() { ENTER(a_F); return { done: true }; } }; } };", step: "(a_F = n + 1, (([x]) => x)(i_F))" },
  "a tag": { decl: "const tag_F = (s, x) => ENTER(x);", step: "tag_F`a${n + 1}b`" },
  "new": { decl: "class C_F { constructor(x) { this.v = ENTER(x); } }", step: "new C_F(n + 1).v" },
  "super": { decl: "class B_F { constructor(x) { this.v = ENTER(x); } } class D_F extends B_F { constructor(x) { super(x); } }", step: "new D_F(n + 1).v" },
  "a constructor nobody wrote": { decl: "class B_F { constructor(x) { this.v = ENTER(x); } } class D_F extends B_F {}", step: "new D_F(n + 1).v" },
  "a field initializer": { decl: "let a_F = 0; class C_F { v = ENTER(a_F); }", step: "(a_F = n + 1, new C_F().v)" },
  "a static block": { step: "(class { static v = ENTER(n + 1); }).v" },
  "super.method": { decl: "class B_F { m(x) { return ENTER(x); } } class D_F extends B_F { m(x) { return super.m(x); } } const d_F = new D_F();", step: "d_F.m(n + 1)" },
  "map": { step: "[n + 1].map(x => ENTER(x))[0]" },
  "forEach": { step: "[n + 1].forEach(x => { ENTER(x); })" },
  "reduce": { step: "[n + 1].reduce((a, x) => ENTER(x), 0)" },
  "sort": { step: "[2, 1].sort(() => { ENTER(n + 1); return 0; }).length" },
  "Array.from": { step: "Array.from([n + 1], x => ENTER(x))[0]" },
  "a Map's forEach": { step: "new Map([[1, n + 1]]).forEach(x => { ENTER(x); })" },
  "replace": { step: "'a'.replace('a', () => String(ENTER(n + 1)))" },
  "replace by a pattern": { step: "'a'.replace(/a/g, () => String(ENTER(n + 1)))" },
  "toJSON": { step: "JSON.stringify({ toJSON() { return ENTER(n + 1); } })" },
  "a reviver": { step: "JSON.parse('1', () => ENTER(n + 1))" },
  "call()": { step: "(x => ENTER(x)).call(null, n + 1)" },
  "apply()": { step: "(x => ENTER(x)).apply(null, [n + 1])" },
  "Reflect.apply": { step: "Reflect.apply(x => ENTER(x), null, [n + 1])" },
  "Reflect.construct": { decl: "function K_F(x) { this.v = ENTER(x); }", step: "Reflect.construct(K_F, [n + 1]).v" },
  "a bound function": { decl: "const b_F = (x => ENTER(x)).bind(null);", step: "b_F(n + 1)" },
  "a list": { step: "(x => ENTER(x))(...[n + 1])" },
  "a default value": { step: "((x = ENTER(n + 1)) => x)()" },
  "hasInstance": { decl: "let a_F = 0; const h_F = { [Symbol.hasInstance]() { ENTER(a_F); return true; } };", step: "(a_F = n + 1, ({}) instanceof h_F)" },
  "one of two closures": { decl: "const fs_F = [x => ENTER(x), x => x];", step: "fs_F[n < 0 ? 1 : 0](n + 1)" },
  "a value nobody knows": { decl: "const u_F = hide(x => ENTER(x));", step: "u_F(n + 1)" },
  "a pattern over a getter": { decl: "let a_F = 0; const g_F = { get next() { return ENTER(a_F); } };", step: "(a_F = n + 1, (({ next }) => next)(g_F))" },
  "a spread over a getter": { decl: "let a_F = 0; const g_F = { get next() { return ENTER(a_F); } };", step: "(a_F = n + 1, ({ ...g_F }).next)" },
  "Object.assign over a getter": { decl: "let a_F = 0; const g_F = { get next() { return ENTER(a_F); } };", step: "(a_F = n + 1, Object.assign({}, g_F).next)" },
  "yield*": { step: "[...(function* () { yield* [ENTER(n + 1)]; })()].length" },
  "a generator's next": { step: "(function* () { yield ENTER(n + 1); })().next().value" },
  "an optional call": { decl: "const o_F = { m: x => ENTER(x) };", step: "o_F?.m?.(n + 1)" },
};

type Guard = { enter: string; body: string; dropsPromises?: true; without?: string[] };
const call = "F(X)";
const guards: Record<string, Guard> = {
  "finally": { enter: call, body: "function F(n) { depth++; try { if (n < 0) return 0; return STEP; } finally { depth--; } }" },
  "a catch that throws again": { enter: call, body: "function F(n) { depth++; try { if (n < 0) { depth--; return 0; } const r = STEP; depth--; return r; } catch (error) { depth--; throw error; } }" },
  // Each level of toJSON answers a text that the level above quotes again: half a minute in plain Bun.
  "a catch that answers": { enter: call, body: "function F(n) { depth++; try { if (n < 0) { depth--; return 0; } const r = STEP; depth--; return r; } catch (error) { depth--; caught++; return 'caught'; } }", without: ["toJSON"] },
  "inside a catch": { enter: call, body: "function F(n) { depth++; try { try { if (n < 0) return 0; throw 1; } catch (one) { return STEP; } } finally { depth--; } }" },
  "inside a finally": { enter: call, body: "function F(n) { depth++; try { try { if (n < 0) return 0; } finally { STEP; } } finally { depth--; } }" },
  "two finallys": { enter: call, body: "function F(n) { depth += 2; try { try { if (n < 0) return 0; return STEP; } finally { depth--; } } finally { depth--; } }" },
  "a method": { enter: "holder_F.run(X)", body: "const holder_F = { run(n) { depth++; try { if (n < 0) return 0; return STEP; } finally { depth--; } } };" },
  "an arrow function": { enter: call, body: "const F = n => { depth++; try { if (n < 0) return 0; return STEP; } finally { depth--; } };" },
  "a generator": { enter: "F(X).next().value", body: "function* F(n) { depth++; try { if (n < 0) return 0; return STEP; } finally { depth--; } }" },
  "an async function": { enter: call, dropsPromises: true, body: "async function F(n) { depth++; try { if (n < 0) return 0; return await STEP; } finally { depth--; } }" },
};

export const namesOfGuards = Object.keys(guards);
export const dropsPromises = (guard: string) => !!guards[guard].dropsPromises;

export const ways: Record<string, string[]> = {
  "as built by default": [],
  "everything hot": ["--aot-heat=everything-is-hot"],
};

export function program(guardName: string) {
  const guard = guards[guardName];
  let text = `let depth = 0, caught = 0;
const hide = value => new CustomEvent("x", { detail: value }).detail;
const forms = [];
`;
  let number = 0;
  for (const [roadName, road] of Object.entries(roads)) {
    if (guard.without?.includes(roadName)) continue;
    const F = "f" + number++;
    const enter = (x: string) => guard.enter.replaceAll("F", F).replace("X", x);
    const fill = (part: string) => part.replace(/ENTER\(([^()]*(?:\([^()]*\))?[^()]*)\)/g, (_, x) => enter(x)).replaceAll("_F", "_" + F);
    text += fill(road.decl ?? "") + "\n";
    text += guard.body.replace("STEP", fill(road.step)).replaceAll("holder_F", "holder_" + F).replace(/\bF\b/g, F) + "\n";
    text += `forms.push([${JSON.stringify(roadName)}, () => ${enter("0")}]);\n`;
  }
  text += `
for (const [label, run] of forms) {
  depth = 0;
  caught = 0;
  let outcome;
  try {
    outcome = "answers " + typeof (await run());
  } catch (error) {
    outcome = error instanceof RangeError ? "RangeError" : "throws " + error.name;
  }
  console.log(label + ": " + outcome + " | depth " + depth + " | caught " + (caught > 0));
}
`;
  return { file: "main.js", text };
}
