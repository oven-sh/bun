// What comes out of concat is used as what it is (function, inferred).
type T = () => number;
function flatten(l: T[][]): T[] { return l.flat(); }
function pushed(x: T): T[][] { const outer: T[][] = []; for (let i = 0; i < 2; i++) { const inner: T[] = []; inner.push(x); outer.push(inner); } return outer; }
function seenBy(l: T[][]): T[] { const seen: T[] = []; JSON.stringify(l, function (k: string, val: any) { if (k !== "" && !Array.isArray(val)) seen.push(val); return typeof val === "function" ? 0 : val; }); return seen; }
const show = (x: unknown) => typeof x === "string" ? JSON.stringify(x) : String(x); // @ts-expect-error
function straight0() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; return e(); }
function used0(e: T, v: T) { return e(); } // @ts-expect-error
function passed0() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); return used0(r[0], v); } // @ts-expect-error
function looped0() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; all += show(e()) + ","; } return all; }
console.log(0, show(straight0()), show(passed0()), looped0()); // @ts-expect-error
function straight1() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; return typeof e; }
function used1(e: T, v: T) { return typeof e; } // @ts-expect-error
function passed1() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); return used1(r[0], v); } // @ts-expect-error
function looped1() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; all += show(typeof e) + ","; } return all; }
console.log(1, show(straight1()), show(passed1()), looped1()); // @ts-expect-error
function straight2() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; return e === v; }
function used2(e: T, v: T) { return e === v; } // @ts-expect-error
function passed2() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); return used2(r[0], v); } // @ts-expect-error
function looped2() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; all += show(e === v) + ","; } return all; }
console.log(2, show(straight2()), show(passed2()), looped2()); // @ts-expect-error
function straight3() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; return e.call(null); }
function used3(e: T, v: T) { return e.call(null); } // @ts-expect-error
function passed3() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); return used3(r[0], v); } // @ts-expect-error
function looped3() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; all += show(e.call(null)) + ","; } return all; }
console.log(3, show(straight3()), show(passed3()), looped3()); // @ts-expect-error
function straight4() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; return Array.isArray(e); }
function used4(e: T, v: T) { return Array.isArray(e); } // @ts-expect-error
function passed4() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); return used4(r[0], v); } // @ts-expect-error
function looped4() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; all += show(Array.isArray(e)) + ","; } return all; }
console.log(4, show(straight4()), show(passed4()), looped4()); // @ts-expect-error
function straight5() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; return e.length; }
function used5(e: T, v: T) { return e.length; } // @ts-expect-error
function passed5() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); return used5(r[0], v); } // @ts-expect-error
function looped5() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; all += show(e.length) + ","; } return all; }
console.log(5, show(straight5()), show(passed5()), looped5()); // @ts-expect-error
function straight6() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; return e instanceof Function; }
function used6(e: T, v: T) { return e instanceof Function; } // @ts-expect-error
function passed6() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); return used6(r[0], v); } // @ts-expect-error
function looped6() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; all += show(e instanceof Function) + ","; } return all; }
console.log(6, show(straight6()), show(passed6()), looped6()); // @ts-expect-error
function straight7() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; return !e; }
function used7(e: T, v: T) { return !e; } // @ts-expect-error
function passed7() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); return used7(r[0], v); } // @ts-expect-error
function looped7() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; all += show(!e) + ","; } return all; }
console.log(7, show(straight7()), show(passed7()), looped7()); // @ts-expect-error
function straight8() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; return e == null; }
function used8(e: T, v: T) { return e == null; } // @ts-expect-error
function passed8() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); return used8(r[0], v); } // @ts-expect-error
function looped8() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; all += show(e == null) + ","; } return all; }
console.log(8, show(straight8()), show(passed8()), looped8()); // @ts-expect-error
function straight9() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; return [1].map(e)[0]; }
function used9(e: T, v: T) { return [1].map(e)[0]; } // @ts-expect-error
function passed9() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); return used9(r[0], v); } // @ts-expect-error
function looped9() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; all += show([1].map(e)[0]) + ","; } return all; }
console.log(9, show(straight9()), show(passed9()), looped9()); // @ts-expect-error
function straight10() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; return e.name.length >= 0; }
function used10(e: T, v: T) { return e.name.length >= 0; } // @ts-expect-error
function passed10() { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); return used10(r[0], v); } // @ts-expect-error
function looped10() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = () => 7; const w: T = () => 9; const r = [].concat([v]); const e: T = r[0]; all += show(e.name.length >= 0) + ","; } return all; }
console.log(10, show(straight10()), show(passed10()), looped10());
