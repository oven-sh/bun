// Captured variables that are assigned after a closure could have seen them are shared, once per call of the enclosing function.
function call<T>(f: () => T): T { return f(); }
function assignedAfter() { let n = 1; const f = () => n; n = 2; return f(); }
function assignedInside() { let n = 1; const f = () => { n = 5; }; f(); return n; }
function twoClosures() { let n = 0; const inc = () => ++n; const get = () => n; inc(); inc(); return get(); }
function assignedParameter(a: number) { const f = () => a; a = 7; return f(); }
function throughCast() { let n: number = 1; const f = () => n; (n as any) = 3; return f(); }
function destructured() { let a = 1, b = 2; const f = () => a * 10 + b; [a, b] = [b, a]; return f(); }
function compound() { let s = "a"; const f = () => s; s += "b"; return f(); }
function bodyIncrement() { const fs: (() => number)[] = []; for (let i = 0; i < 6; i++) { fs.push(() => i); i++; } return fs.map(f => f()).join(); }
function madeInUpdate() { const fs: (() => number)[] = []; for (let i = 0; i < 3; fs.push(() => i), i++) {} return fs.map(f => f()).join(); }
function madeInTest() { const fs: (() => number)[] = []; for (let i = 0; fs.push(() => i), i < 3; i++) {} return fs.map(f => f()).join(); }
function madeInInitializer() { const out: number[] = []; for (let i = 0, f = () => i; i < 3; i++) { out.push(f()); } return out.join(); }
function initializerKeepsFirst() { let g = () => -1; for (let i = 0, f = (g = () => i); i < 12; i++) { i += 10; if (f !== g) return -2; } return g(); }
function updateSeesBody() { const fs: (() => number)[] = []; for (let i = 0; i < 6; fs.push(() => i), i++) { i++; } return fs.map(f => f()).join(); }
function ofIterable() { const fs: (() => number)[] = []; for (const x of (fs.push((): number => x), [1, 2])) { fs.push(() => x); } const out: string[] = []; for (const f of fs) { try { out.push(String(f())); } catch (e) { out.push((e as Error).name); } } return out.join(); }
function inObject() { const fs: (() => string)[] = []; for (const k in (fs.push((): string => k), { a: 1, b: 2 })) { fs.push(() => k); } const out: string[] = []; for (const f of fs) { try { out.push(f()); } catch (e) { out.push((e as Error).name); } } return out.join(); }
function ofReassigned() { const fs: (() => number)[] = []; for (let x of (fs.push((): number => x), [1, 2])) { x += 10; fs.push(() => x); } const out: string[] = []; for (const f of fs) { try { out.push(String(f())); } catch (e) { out.push((e as Error).name); } } return out.join(); }
function earlierDefault(f = () => b, b = 2) { return f(); }
function deadZone() { const f = () => k; try { return f(); } catch (e) { return (e as Error).name; } const k = Number("1"); }
function perIteration() { const fs: (() => number)[] = []; for (const x of [1, 2, 3]) { let n = x; fs.push(() => n++); } return fs.map(f => f() + f()).join(); }
function whileLoop() { const fs: (() => number)[] = []; let i = 0; while (i < 3) { let n = i * 10; fs.push(() => ++n); i++; } return fs.map(f => f()).join() + ":" + call(() => i); }
function secondIteration() { const out: string[] = []; for (let i = 0; i < 2; i++) { const g = () => x; if (i) { try { out.push(String(g())); } catch (e) { out.push((e as Error).name); } } let x = i; x++; out.push(String(g())); } return out.join(); }
function varHoisted() { const f = () => v; var v = 4; return f(); }
function five(a: number, b: number, c: number, d: number, e: number) { return call(() => a + b + c + d + e); }
function blocks(flag: boolean) { let total = 0; { let a = 1; call(() => { a++; total += a; }); } if (flag) { let b = 10; call(() => { b++; total += b; }); } { let a = 100; call(() => { a++; total += a; }); } return total; }
function recursion(n: number): number { let acc = n; const add = () => { acc += 1; }; add(); return n > 0 ? acc + recursion(n - 1) : acc; }
console.log(assignedAfter(), assignedInside(), twoClosures(), assignedParameter(1), throughCast(), destructured(), compound());
console.log(bodyIncrement(), madeInUpdate(), earlierDefault(), deadZone(), perIteration(), whileLoop(), secondIteration());
console.log(madeInTest(), madeInInitializer(), initializerKeepsFirst(), updateSeesBody());
console.log(ofIterable(), inObject(), ofReassigned());
console.log(varHoisted(), five(1, 2, 3, 4, 5), blocks(true), blocks(false), recursion(3));
