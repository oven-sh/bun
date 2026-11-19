// a typed record is taken apart: one name, and the rest. The names are this file's own.
interface Entry { rank: number; title: string; done: boolean; cost: number }
let whole: Entry = { rank: 1, title: "b", done: true, cost: 2 };
function written({ rank, title, done, cost }: Entry): number { return Object.keys({ title, done, cost }).length + rank; }
function rest({ rank, ...others }: Entry): number { return Object.keys(others).length + rank; }
export const loops: Record<string, (n: number) => number> = {
  "the other names written out": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (written(whole))) | 0; whole = { ...whole, rank: 1 }; return s; },
  "a record without one of its names": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (rest(whole))) | 0; whole = { ...whole, rank: 1 }; return s; },
};
