function cut(list: number[], t: number): number { let s = 0; for (let i = 0; i < list.length; i++) s = (s + list[i]! + t) | 0; return s; }
function less(list: number[], t: number): number { let s = 0; for (let i = 0; i < list.length; i++) s = (s - t + list[i]!) >>> 0; return s; }
function both(list: number[], t: number, u: number): number { let s = 0; for (let i = 0; i < list.length; i++) s = ((s ^ list[i]!) + t - u >>> 1) & 1023; return s; }
function deep(list: number[], t: number): number { let s = 0; for (let i = 0; i < list.length; i++) s = (((s + t) + (list[i]! + t)) + (t + 1)) | 0; return s; }
function loose(list: unknown[], t: unknown): number { let s = 0; for (let i = 0; i < list.length; i++) s = (s + (list[i] as number) + (t as number)) | 0; return s; }
function none(list: number[], t: number): number { let s = 7; for (let i = 0; i < 0; i++) s = (s + list[i]! + t) | 0; return s + t; }
const list = [1, 2147483647, 5, -9, 1000000];
for (const t of [3, 0, -1, 2147483647, -2147483648, 2147483648, -2147483649, 4294967296, 9007199254740992, 0.5, -0.5, 1e300, NaN, Infinity, -Infinity, -0])
  console.log(t, cut(list, t), less(list, t), both(list, t, 7), both(list, 7, t), deep(list, t), none(list, t), Object.is(none(list, t), -0));
console.log(cut([0.5, 1.5], 1), cut([2 ** 53, 1], 1), cut([], 5), cut([NaN], 1), less([4294967295], 1));
console.log(loose([1, 2], "3"), loose([1, 2], null), loose([1, 2], undefined), loose(["1", 2], 3), loose([1, 2], true), loose([1, 2], { valueOf() { return 4; } }));
