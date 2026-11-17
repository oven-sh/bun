(globalThis as any).runs = ((globalThis as any).runs ?? 0) + 1;
export class Kind { static w = "real" + (globalThis as any).runs; }
export const mark = (target: any, key: any) => { (target.marks ??= []).push(Kind.w); };
