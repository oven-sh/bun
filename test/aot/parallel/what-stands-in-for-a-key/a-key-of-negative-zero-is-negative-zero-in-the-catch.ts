"use strict";
function store(list: number[], from: number) {
  let key = 1;
  try { for (let i = from | 0; i < 3; i++) { key = i % 4; list[key] = i; } }
  catch { return Object.is(key, -0); }
  return "none";
}
console.log(store([1, 2, 3, 4], 0), store(Object.freeze([1, 2, 3, 4]) as any, Number(process.env.NO_SUCH ?? -4)));
export {};
