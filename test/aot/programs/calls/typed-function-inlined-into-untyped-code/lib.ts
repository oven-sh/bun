export interface Def { id: string }
export interface Slot { name: string | null; owner: Def | null }
export interface State { winner: Def | null; rule: { flag: boolean } | null; count: number; spare: Slot }
export function makeSlot(): Slot { return { name: null, owner: null }; }
const state: State = { winner: null, rule: null, count: 0, spare: { name: "spare", owner: null } };
export function getState(): State { return state; }
export function makeList(): number[] { return [1]; }
export function makeMap(): Map<string, number> { return new Map(); }
export function makeDef(id: string): Def { return { id }; }
export function describe(s: Slot): string { return s.name + "/" + (s.owner ? s.owner.id : "none"); }
export function sum(a: number[]): number { let t = 0; for (const x of a) t += x; return t; }
