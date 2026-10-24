export interface Api { f(x: number): number }
export const own: Api = Object.freeze({ f: (x: number) => x * 2 });
