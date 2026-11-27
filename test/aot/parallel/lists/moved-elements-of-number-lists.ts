const out: string[] = [];
const source: number[] = []; for (let i = 0; i < 200; i++) source.push(i);
function show(a: any[]): string { let s = a.length + ":"; for (let i = 0; i < a.length && i < 40; i++) s += (i in a ? Object.is(a[i], -0) ? "-0" : String(a[i]) : "hole") + ","; return s; }
function run(name: string, f: (n: number, turn: number) => any[]): void { for (let turn = 0; turn < 5; turn++) for (const n of [0, 1, 5, 33]) { try { out.push(name + turn + " " + show(f(n, turn))); } catch (e: any) { out.push(name + e.name); } } }
function f0_0(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { for (let i = 0, j = a.length - 1; i < j; i++, j--) { const t = a[i]!; a[i] = a[j]!; a[j] = t; } }  { for (let i = 0, j = a.length - 1; i < j; i++, j--) { const t = a[i]!; a[i] = a[j]!; a[j] = t; } }  return a; }
run("swap0", f0_0);
function f0_2(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 2) a[0] = 1.5; { for (let i = 0, j = a.length - 1; i < j; i++, j--) { const t = a[i]!; a[i] = a[j]!; a[j] = t; } } if (turn === 2) a[0] = 1.5; { for (let i = 0, j = a.length - 1; i < j; i++, j--) { const t = a[i]!; a[i] = a[j]!; a[j] = t; } }  return a; }
run("swap2", f0_2);
function f0_4(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 1) (a as any)[0] = undefined; { for (let i = 0, j = a.length - 1; i < j; i++, j--) { const t = a[i]!; a[i] = a[j]!; a[j] = t; } } if (turn === 1) (a as any)[0] = undefined; { for (let i = 0, j = a.length - 1; i < j; i++, j--) { const t = a[i]!; a[i] = a[j]!; a[j] = t; } }  return a; }
run("swap4", f0_4);
function f0_6(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { for (let i = 0, j = a.length - 1; i < j; i++, j--) { const t = a[i]!; a[i] = a[j]!; a[j] = t; } } if (turn > 1) a.length = 4; { for (let i = 0, j = a.length - 1; i < j; i++, j--) { const t = a[i]!; a[i] = a[j]!; a[j] = t; } }  return a; }
run("swap6", f0_6);
function f1_1(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x); try { a[1] = 0.25; { for (let i = a.length - 1; i > 0; i--) a[i] = a[i - 1]!; } a[1] = 0.25; { for (let i = a.length - 1; i > 0; i--) a[i] = a[i - 1]!; } } catch (e: any) { out.push(e.name); } return a; }
run("shiftUp1", f1_1);
function f1_3(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { for (let i = a.length - 1; i > 0; i--) a[i] = a[i - 1]!; } (a as any)[2] = "x"; { for (let i = a.length - 1; i > 0; i--) a[i] = a[i - 1]!; }  return a; }
run("shiftUp3", f1_3);
function f1_5(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x); try { a[3] = 2147483648; { for (let i = a.length - 1; i > 0; i--) a[i] = a[i - 1]!; } a[3] = 2147483648; { for (let i = a.length - 1; i > 0; i--) a[i] = a[i - 1]!; } } catch (e: any) { out.push(e.name); } return a; }
run("shiftUp5", f1_5);
function f1_7(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 3) Object.freeze(a); { for (let i = a.length - 1; i > 0; i--) a[i] = a[i - 1]!; } if (turn === 3) Object.freeze(a); { for (let i = a.length - 1; i > 0; i--) a[i] = a[i - 1]!; }  return a; }
run("shiftUp7", f1_7);
function f2_0(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { for (let i = 0; i + 1 < a.length; i++) a[i] = a[i + 1]!; }  { for (let i = 0; i + 1 < a.length; i++) a[i] = a[i + 1]!; }  return a; }
run("shiftDown0", f2_0);
function f2_2(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 2) a[0] = 1.5; { for (let i = 0; i + 1 < a.length; i++) a[i] = a[i + 1]!; } if (turn === 2) a[0] = 1.5; { for (let i = 0; i + 1 < a.length; i++) a[i] = a[i + 1]!; }  return a; }
run("shiftDown2", f2_2);
function f2_4(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 1) (a as any)[0] = undefined; { for (let i = 0; i + 1 < a.length; i++) a[i] = a[i + 1]!; } if (turn === 1) (a as any)[0] = undefined; { for (let i = 0; i + 1 < a.length; i++) a[i] = a[i + 1]!; }  return a; }
run("shiftDown4", f2_4);
function f2_6(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { for (let i = 0; i + 1 < a.length; i++) a[i] = a[i + 1]!; } if (turn > 1) a.length = 4; { for (let i = 0; i + 1 < a.length; i++) a[i] = a[i + 1]!; }  return a; }
run("shiftDown6", f2_6);
function f3_1(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x); try { a[1] = 0.25; { for (let i = 0; i < a.length && i < 60; i++) a[i] = a[i + 1]!; } a[1] = 0.25; { for (let i = 0; i < a.length && i < 60; i++) a[i] = a[i + 1]!; } } catch (e: any) { out.push(e.name); } return a; }
run("pastEnd1", f3_1);
function f3_3(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { for (let i = 0; i < a.length && i < 60; i++) a[i] = a[i + 1]!; } (a as any)[2] = "x"; { for (let i = 0; i < a.length && i < 60; i++) a[i] = a[i + 1]!; }  return a; }
run("pastEnd3", f3_3);
function f3_5(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x); try { a[3] = 2147483648; { for (let i = 0; i < a.length && i < 60; i++) a[i] = a[i + 1]!; } a[3] = 2147483648; { for (let i = 0; i < a.length && i < 60; i++) a[i] = a[i + 1]!; } } catch (e: any) { out.push(e.name); } return a; }
run("pastEnd5", f3_5);
function f3_7(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 3) Object.freeze(a); { for (let i = 0; i < a.length && i < 60; i++) a[i] = a[i + 1]!; } if (turn === 3) Object.freeze(a); { for (let i = 0; i < a.length && i < 60; i++) a[i] = a[i + 1]!; }  return a; }
run("pastEnd7", f3_7);
function f4_0(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { for (let k = 0; k < 5; k++) { const f = a[0]!; for (let i = 1; i < a.length; i++) a[i - 1] = a[i]!; a[a.length - 1] = f; } }  { for (let k = 0; k < 5; k++) { const f = a[0]!; for (let i = 1; i < a.length; i++) a[i - 1] = a[i]!; a[a.length - 1] = f; } }  return a; }
run("rotate0", f4_0);
function f4_2(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 2) a[0] = 1.5; { for (let k = 0; k < 5; k++) { const f = a[0]!; for (let i = 1; i < a.length; i++) a[i - 1] = a[i]!; a[a.length - 1] = f; } } if (turn === 2) a[0] = 1.5; { for (let k = 0; k < 5; k++) { const f = a[0]!; for (let i = 1; i < a.length; i++) a[i - 1] = a[i]!; a[a.length - 1] = f; } }  return a; }
run("rotate2", f4_2);
function f4_4(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 1) (a as any)[0] = undefined; { for (let k = 0; k < 5; k++) { const f = a[0]!; for (let i = 1; i < a.length; i++) a[i - 1] = a[i]!; a[a.length - 1] = f; } } if (turn === 1) (a as any)[0] = undefined; { for (let k = 0; k < 5; k++) { const f = a[0]!; for (let i = 1; i < a.length; i++) a[i - 1] = a[i]!; a[a.length - 1] = f; } }  return a; }
run("rotate4", f4_4);
function f4_6(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { for (let k = 0; k < 5; k++) { const f = a[0]!; for (let i = 1; i < a.length; i++) a[i - 1] = a[i]!; a[a.length - 1] = f; } } if (turn > 1) a.length = 4; { for (let k = 0; k < 5; k++) { const f = a[0]!; for (let i = 1; i < a.length; i++) a[i - 1] = a[i]!; a[a.length - 1] = f; } }  return a; }
run("rotate6", f4_6);
function f5_1(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x); try { a[1] = 0.25; { for (let i = 1; i < a.length; i++) { const v = a[i]!; let j = i; while (j > 0 && a[j - 1]! < v) { a[j] = a[j - 1]!; j--; } a[j] = v; } } a[1] = 0.25; { for (let i = 1; i < a.length; i++) { const v = a[i]!; let j = i; while (j > 0 && a[j - 1]! < v) { a[j] = a[j - 1]!; j--; } a[j] = v; } } } catch (e: any) { out.push(e.name); } return a; }
run("sort1", f5_1);
function f5_3(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { for (let i = 1; i < a.length; i++) { const v = a[i]!; let j = i; while (j > 0 && a[j - 1]! < v) { a[j] = a[j - 1]!; j--; } a[j] = v; } } (a as any)[2] = "x"; { for (let i = 1; i < a.length; i++) { const v = a[i]!; let j = i; while (j > 0 && a[j - 1]! < v) { a[j] = a[j - 1]!; j--; } a[j] = v; } }  return a; }
run("sort3", f5_3);
function f5_5(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x); try { a[3] = 2147483648; { for (let i = 1; i < a.length; i++) { const v = a[i]!; let j = i; while (j > 0 && a[j - 1]! < v) { a[j] = a[j - 1]!; j--; } a[j] = v; } } a[3] = 2147483648; { for (let i = 1; i < a.length; i++) { const v = a[i]!; let j = i; while (j > 0 && a[j - 1]! < v) { a[j] = a[j - 1]!; j--; } a[j] = v; } } } catch (e: any) { out.push(e.name); } return a; }
run("sort5", f5_5);
function f5_7(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 3) Object.freeze(a); { for (let i = 1; i < a.length; i++) { const v = a[i]!; let j = i; while (j > 0 && a[j - 1]! < v) { a[j] = a[j - 1]!; j--; } a[j] = v; } } if (turn === 3) Object.freeze(a); { for (let i = 1; i < a.length; i++) { const v = a[i]!; let j = i; while (j > 0 && a[j - 1]! < v) { a[j] = a[j - 1]!; j--; } a[j] = v; } }  return a; }
run("sort7", f5_7);
function f6_0(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { let s = 7; for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; } }  { let s = 7; for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; } }  return a; }
run("shuffle0", f6_0);
function f6_2(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 2) a[0] = 1.5; { let s = 7; for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; } } if (turn === 2) a[0] = 1.5; { let s = 7; for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; } }  return a; }
run("shuffle2", f6_2);
function f6_4(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 1) (a as any)[0] = undefined; { let s = 7; for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; } } if (turn === 1) (a as any)[0] = undefined; { let s = 7; for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; } }  return a; }
run("shuffle4", f6_4);
function f6_6(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { let s = 7; for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; } } if (turn > 1) a.length = 4; { let s = 7; for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; } }  return a; }
run("shuffle6", f6_6);
function f7_1(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x); try { a[1] = 0.25; { for (let i = 0, n = a.length; i < n; i++) a[n + i] = a[i]!; } a[1] = 0.25; { for (let i = 0, n = a.length; i < n; i++) a[n + i] = a[i]!; } } catch (e: any) { out.push(e.name); } return a; }
run("grow1", f7_1);
function f7_3(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { for (let i = 0, n = a.length; i < n; i++) a[n + i] = a[i]!; } (a as any)[2] = "x"; { for (let i = 0, n = a.length; i < n; i++) a[n + i] = a[i]!; }  return a; }
run("grow3", f7_3);
function f7_5(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x); try { a[3] = 2147483648; { for (let i = 0, n = a.length; i < n; i++) a[n + i] = a[i]!; } a[3] = 2147483648; { for (let i = 0, n = a.length; i < n; i++) a[n + i] = a[i]!; } } catch (e: any) { out.push(e.name); } return a; }
run("grow5", f7_5);
function f7_7(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 3) Object.freeze(a); { for (let i = 0, n = a.length; i < n; i++) a[n + i] = a[i]!; } if (turn === 3) Object.freeze(a); { for (let i = 0, n = a.length; i < n; i++) a[n + i] = a[i]!; }  return a; }
run("grow7", f7_7);
function f8_0(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { for (let i = 0; i < 3; i++) a[a.length + 2] = a[i]!; }  { for (let i = 0; i < 3; i++) a[a.length + 2] = a[i]!; }  return a; }
run("copyBeyond0", f8_0);
function f8_2(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 2) a[0] = 1.5; { for (let i = 0; i < 3; i++) a[a.length + 2] = a[i]!; } if (turn === 2) a[0] = 1.5; { for (let i = 0; i < 3; i++) a[a.length + 2] = a[i]!; }  return a; }
run("copyBeyond2", f8_2);
function f8_4(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 1) (a as any)[0] = undefined; { for (let i = 0; i < 3; i++) a[a.length + 2] = a[i]!; } if (turn === 1) (a as any)[0] = undefined; { for (let i = 0; i < 3; i++) a[a.length + 2] = a[i]!; }  return a; }
run("copyBeyond4", f8_4);
function f8_6(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { for (let i = 0; i < 3; i++) a[a.length + 2] = a[i]!; } if (turn > 1) a.length = 4; { for (let i = 0; i < 3; i++) a[a.length + 2] = a[i]!; }  return a; }
run("copyBeyond6", f8_6);
function f9_1(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x); try { a[1] = 0.25; { for (const k of [3, 1, 2, 9, 4]) { const b = a[k]!; for (let i = k; i > 0; i--) a[i] = a[i - 1]!; a[0] = b; } } a[1] = 0.25; { for (const k of [3, 1, 2, 9, 4]) { const b = a[k]!; for (let i = k; i > 0; i--) a[i] = a[i - 1]!; a[0] = b; } } } catch (e: any) { out.push(e.name); } return a; }
run("front1", f9_1);
function f9_3(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { for (const k of [3, 1, 2, 9, 4]) { const b = a[k]!; for (let i = k; i > 0; i--) a[i] = a[i - 1]!; a[0] = b; } } (a as any)[2] = "x"; { for (const k of [3, 1, 2, 9, 4]) { const b = a[k]!; for (let i = k; i > 0; i--) a[i] = a[i - 1]!; a[0] = b; } }  return a; }
run("front3", f9_3);
function f9_5(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x); try { a[3] = 2147483648; { for (const k of [3, 1, 2, 9, 4]) { const b = a[k]!; for (let i = k; i > 0; i--) a[i] = a[i - 1]!; a[0] = b; } } a[3] = 2147483648; { for (const k of [3, 1, 2, 9, 4]) { const b = a[k]!; for (let i = k; i > 0; i--) a[i] = a[i - 1]!; a[0] = b; } } } catch (e: any) { out.push(e.name); } return a; }
run("front5", f9_5);
function f9_7(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 3) Object.freeze(a); { for (const k of [3, 1, 2, 9, 4]) { const b = a[k]!; for (let i = k; i > 0; i--) a[i] = a[i - 1]!; a[0] = b; } } if (turn === 3) Object.freeze(a); { for (const k of [3, 1, 2, 9, 4]) { const b = a[k]!; for (let i = k; i > 0; i--) a[i] = a[i - 1]!; a[0] = b; } }  return a; }
run("front7", f9_7);
function f10_0(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { for (let i = 0; i < a.length; i += 2) { const k: any = String(i); a[k] = a[i + 1]!; } }  { for (let i = 0; i < a.length; i += 2) { const k: any = String(i); a[k] = a[i + 1]!; } }  return a; }
run("text0", f10_0);
function f10_2(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 2) a[0] = 1.5; { for (let i = 0; i < a.length; i += 2) { const k: any = String(i); a[k] = a[i + 1]!; } } if (turn === 2) a[0] = 1.5; { for (let i = 0; i < a.length; i += 2) { const k: any = String(i); a[k] = a[i + 1]!; } }  return a; }
run("text2", f10_2);
function f10_4(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 1) (a as any)[0] = undefined; { for (let i = 0; i < a.length; i += 2) { const k: any = String(i); a[k] = a[i + 1]!; } } if (turn === 1) (a as any)[0] = undefined; { for (let i = 0; i < a.length; i += 2) { const k: any = String(i); a[k] = a[i + 1]!; } }  return a; }
run("text4", f10_4);
function f10_6(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { for (let i = 0; i < a.length; i += 2) { const k: any = String(i); a[k] = a[i + 1]!; } } if (turn > 1) a.length = 4; { for (let i = 0; i < a.length; i += 2) { const k: any = String(i); a[k] = a[i + 1]!; } }  return a; }
run("text6", f10_6);
function f11_1(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x); try { a[1] = 0.25; { for (let i = 0; i < a.length; i++) { const v = a[i - 1]; if (v !== undefined) a[i] = v; } } a[1] = 0.25; { for (let i = 0; i < a.length; i++) { const v = a[i - 1]; if (v !== undefined) a[i] = v; } } } catch (e: any) { out.push(e.name); } return a; }
run("optional1", f11_1);
function f11_3(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { for (let i = 0; i < a.length; i++) { const v = a[i - 1]; if (v !== undefined) a[i] = v; } } (a as any)[2] = "x"; { for (let i = 0; i < a.length; i++) { const v = a[i - 1]; if (v !== undefined) a[i] = v; } }  return a; }
run("optional3", f11_3);
function f11_5(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x); try { a[3] = 2147483648; { for (let i = 0; i < a.length; i++) { const v = a[i - 1]; if (v !== undefined) a[i] = v; } } a[3] = 2147483648; { for (let i = 0; i < a.length; i++) { const v = a[i - 1]; if (v !== undefined) a[i] = v; } } } catch (e: any) { out.push(e.name); } return a; }
run("optional5", f11_5);
function f11_7(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 3) Object.freeze(a); { for (let i = 0; i < a.length; i++) { const v = a[i - 1]; if (v !== undefined) a[i] = v; } } if (turn === 3) Object.freeze(a); { for (let i = 0; i < a.length; i++) { const v = a[i - 1]; if (v !== undefined) a[i] = v; } }  return a; }
run("optional7", f11_7);
function f12_0(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { for (let i = 1; i < a.length; i++) a[i] = a[i]! + a[i - 1]!; }  { for (let i = 1; i < a.length; i++) a[i] = a[i]! + a[i - 1]!; }  return a; }
run("add0", f12_0);
function f12_2(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 2) a[0] = 1.5; { for (let i = 1; i < a.length; i++) a[i] = a[i]! + a[i - 1]!; } if (turn === 2) a[0] = 1.5; { for (let i = 1; i < a.length; i++) a[i] = a[i]! + a[i - 1]!; }  return a; }
run("add2", f12_2);
function f12_4(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);  if (turn === 1) (a as any)[0] = undefined; { for (let i = 1; i < a.length; i++) a[i] = a[i]! + a[i - 1]!; } if (turn === 1) (a as any)[0] = undefined; { for (let i = 1; i < a.length; i++) a[i] = a[i]! + a[i - 1]!; }  return a; }
run("add4", f12_4);
function f12_6(n: number, turn: number): any[] { const a: number[] = source.slice(0, n).map(x => x & 1 ? x / 2 : x);   { for (let i = 1; i < a.length; i++) a[i] = a[i]! + a[i - 1]!; } if (turn > 1) a.length = 4; { for (let i = 1; i < a.length; i++) a[i] = a[i]! + a[i - 1]!; }  return a; }
run("add6", f12_6);
console.log(out.join("\n"));
