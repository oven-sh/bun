// A closure that is made behind the last store to a variable of its maker copies the variable; one that a store can still follow shares it: each reads what plain Bun reads
function settled(options?: { x: number }) { options = options || { x: 1 }; return () => options!.x; }
function storedBehind(n: number) { let v = n; const early = () => v; v = v + 1; const late = () => v; v = v + 1; return [early, late, () => v]; }
function inLoop(n: number) { let total = 0; const all: (() => number)[] = []; for (let i = 0; i < n; i++) { total += i; all.push(() => total); } all.push(() => total); return all; }
function inRightSide() { let f: () => unknown = () => 0; f = () => f; return f; }
function storedByClosure() { let c = 0; c = 1; const bump = () => { c++; }; const read = () => c; bump(); return read; }
function updated() { let c = 0; c++; const read = () => c; return read; }
function inFinally() { let c = 0; let read: () => number; try { c = 1; read = () => c; } finally { c = 2; } return read; }
function hoisted() { let c = 0; c = 5; return inner; function inner() { return c; } }
function nested() { let c = 0; c = 7; return () => () => c; }
function conditional(flag: boolean) { let c = 0; if (flag) c = 3; return () => c; }
function destructured(pair: [number, number]) { let a = 0, b = 0; [a, b] = pair; return () => a * 10 + b; }
function inSwitch(k: number) { let c = 0; let read = () => -1; switch (k) { case 0: read = () => c; case 1: c = 9; } return read; }
console.log(settled()(), settled({ x: 4 })());
console.log(storedBehind(1).map(f => f()).join());
console.log(inLoop(4).map(f => f()).join());
console.log(inRightSide()() === inRightSide ? "no" : typeof inRightSide()());
console.log(storedByClosure()(), updated()(), inFinally()(), hoisted()(), nested()()(), conditional(true)(), conditional(false)(), destructured([2, 3])(), inSwitch(0)(), inSwitch(1)());
