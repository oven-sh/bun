// a typed record is copied with a field changed.
interface State { a: number; b: string; c: boolean; d: number }
let written: State = { a: 1, b: "b", c: true, d: 2 }, spread: State = { a: 1, b: "b", c: true, d: 2 };
export const loops: Record<string, (n: number) => number> = {
  "a record written out": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + ((written = { a: i, b: written.b, c: written.c, d: written.d }).d)) | 0; return s; },
  "a record spread": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + ((spread = { ...spread, a: i }).d)) | 0; return s; },
};
