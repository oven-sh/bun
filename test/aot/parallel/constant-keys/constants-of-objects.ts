// Strings that fields of constant objects hold, as keys and in equalities: as written, shared by objects, changed on the way by every road there is.
const KEYS = { COUNT: "count", SIZE: "size" } as const;
const ACTIONS = { ADD: "add", SUB: "sub" };
const FROZEN = Object.freeze({ A: "a", B: "b" });
const CHANGED = { CA: "a", CB: "b" };
const ALIASED = { LA: "a" }; const alias: any = ALIASED;
const ASSIGNED = { SA: "a" };
const DEFINED = { DA: "a" };
const DELETED = { EA: "a" };
const BY_KEY = { KA: "a", KB: "b" };
const HANDED = { HA: "a" };
type Same = { S: string }; const SAME_A: Same = { S: "a" }; const SAME_B: Same = { S: "b" };
const INDEX = { FIRST: "0", PROTO: "__proto__", LENGTH: "length" };
let moved = { MA: "a" };
const xs: number[] = JSON.parse("[1,2,3,4,5,6,7,8]");
function nobody(o: any) { return o; }
function show(v: any): string { return v && typeof v === "object" ? "{" + Reflect.ownKeys(v).map(k => String(k) + ":" + show(v[k])).join() + "}" : String(v); }
function said(name: string, body: (round: number) => unknown): void { const all: string[] = []; for (let round = 0; round < 3; round++) { try { all.push(show(body(round))); } catch (error) { all.push((error as Error).name); } } console.log(name, all.join(" ")); }
said("typed", () => { const o = { count: 0, size: 2 }; for (const x of xs) { o[KEYS.COUNT] = (o[KEYS.COUNT] + x) & 7; o[KEYS.SIZE]++; } return o; });
said("untyped", () => { const o: any = {}; for (const x of xs) { o[KEYS.COUNT] = (o[KEYS.COUNT] ?? 0) + x; if (KEYS.SIZE in o) delete o[KEYS.SIZE]; else o[KEYS.SIZE] = x; } return o; });
said("actions", () => { let s = 0; for (const x of xs) { const type: string = x & 1 ? "add" : x & 2 ? "sub" : "other"; switch (type) { case ACTIONS.ADD: s += x; break; case ACTIONS.SUB: s -= x; break; default: s *= 2; } if (type === ACTIONS.ADD) s++; } return s; });
said("frozen", () => { const o: any = { a: 1, b: 2 }; let s = ""; for (const x of xs) s += o[FROZEN.A] + o[x & 1 ? FROZEN.A : FROZEN.B]; return s; });
said("changed", round => { const o: any = { a: 1, b: 2 }; let s = ""; for (const x of xs) { s += o[CHANGED.CA]; if (x === 4 && round === 1) CHANGED.CA = "b"; } return s + (CHANGED.CA === "a"); });
said("aliased", round => { const o: any = { a: 1, b: 2 }; let s = ""; for (const x of xs) { s += o[ALIASED.LA]; if (x === 4) alias.LA = round === 1 ? "a" : "b"; } return s; });
said("assigned", round => { if (round === 1) Object.assign(ASSIGNED, { SA: "b" }); return ({ a: 1, b: 2 } as any)[ASSIGNED.SA]; });
said("defined", round => { if (round === 1) Object.defineProperty(DEFINED, "DA", { get: () => "b" }); return ({ a: 1, b: 2 } as any)[DEFINED.DA]; });
said("deleted", round => { if (round === 1) delete (DELETED as any).EA; return ({ a: 1, undefined: 3 } as any)[DELETED.EA]; });
said("by key", round => { if (round === 1) for (const k of Object.keys(BY_KEY)) (BY_KEY as any)[k] = "b"; return ({ a: 1, b: 2 } as any)[BY_KEY.KA]; });
said("handed on", round => { if (round === 1) nobody(HANDED).HA = "b"; return ({ a: 1, b: 2 } as any)[HANDED.HA]; });
said("one shape", () => { const o: any = { a: 1, b: 2 }; return [o[SAME_A.S], o[SAME_B.S]].join(); });
said("odd names", () => { const o: any = ["x", "y"]; return [o[INDEX.FIRST], o[INDEX.LENGTH], o[INDEX.PROTO] === Array.prototype, show({ [INDEX.PROTO]: 1, [INDEX.FIRST]: 2 })].join(); });
said("moved", round => { if (round === 1) moved = { MA: "b" }; return ({ a: 1, b: 2 } as any)[moved.MA]; });
said("early", () => { const read = () => ({ a: 1 } as any)[LATE.TA]; let got: any; try { got = read(); } catch (error) { got = (error as Error).name; } const LATE = { TA: "a" }; return [got, read()].join(); });
