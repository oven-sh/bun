(globalThis as any).runs = ((globalThis as any).runs ?? 0) + 1;
export const word = "real" + (globalThis as any).runs;
export namespace N { export const deep = word; }
export enum E { A = 1 }
export default class D { static w = word; }
