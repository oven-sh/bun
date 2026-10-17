import { A, E } from "./a";
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
export const early = [said(() => A.m()), said(() => E.m()), said(() => A.f())].join();
const kept: unknown[] = [];
export function peek(when: string, K: typeof A) {
  console.log(when + ": " + [said(() => K.m() === K.m()), said(() => K.hasMethod(K)), said(() => K.has(K)), said(() => K.f()), said(() => K.put(5)), said(() => K.f())].join());
  kept.push(K.m());
}
export function late(when: string) {
  kept.push(A.m());
  console.log(when + ": " + [A.m() === A.m(), E.m() === E.m(), (A.m() as unknown) === E.m(), A.f(), A.has(A), kept.every(f => f === kept[0]), kept.length].join());
}
