export class Keeper { base = 1; async fetchOne(key: unknown) { await null; return "kept " + key + this.base; } }
export async function real(x: unknown) { await null; return "real " + x; }
export const hooks: { current: (x: unknown) => unknown } = { current: real };
export function missed(x: unknown) { return "missed " + x; }
const show = (got: unknown) => typeof got + " " + String(got);
export function ask(x: unknown) { return hooks.current(x); }
export function fetchFrom(keeper: Keeper, x: unknown) { return keeper.fetchOne(x); }
export async function byChoice(hit: boolean, x: unknown) { return show(await (hit ? hooks.current(x) : missed(x))); }
export async function byCopy(x: unknown) { return show(await ask(x)); }
export async function byMethod(keeper: Keeper, hit: boolean, x: unknown) { return show(await (hit ? keeper.fetchOne(x) : missed(x))); }
export async function byCopiedMethod(keeper: Keeper, x: unknown) { return show(await fetchFrom(keeper, x)); }
export async function inLoop(keeper: Keeper, count: number) { let text = ""; for (let i = 0; i < count; i++) text += show(await (i % 2 ? keeper.fetchOne(i) : missed(i))) + ";"; return text; }
export async function byParameter(f: (x: unknown) => unknown, hit: boolean, x: unknown) { return show(await (hit ? f(x) : missed(x))); }
