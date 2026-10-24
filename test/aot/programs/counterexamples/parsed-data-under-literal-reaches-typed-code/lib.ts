export interface Free { piece: { part: number }; title: string }
export interface Holder { inner: Free; name: string }
export function readsFree(p: Free): string { return p.title + p.piece.part }
export function readsHolder(h: Holder): string { return h.name + readsFree(h.inner) }
export function makesHolder(n: number): Holder { return { inner: { piece: { part: n }, title: "made" }, name: "m" } }
