export interface Free { piece: { part: number }; title: string }
export function readsFree(p: Free): string { return p.title + p.piece.part }
export function makesFree(n: number): Free { return { piece: { part: n }, title: "made" } }
export interface Flat { part: number; title: string }
export function readsFlat(p: Flat): string { return p.title + p.part }
export function makesFlat(n: number): Flat { return { part: n, title: "made" } }
export interface Wrap { f: Free; k: number }
export function makesWrap(n: number): Wrap { return { f: makesFree(n), k: n } }
export function readsWrap(w: Wrap): string { return w.k + readsFree(w.f) }
