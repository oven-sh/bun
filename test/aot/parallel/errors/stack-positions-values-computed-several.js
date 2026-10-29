// Each line: where the frame stands when what is called, constructed or tested is a value that Bun's transpiler computes from variables in several steps.
function show(run) { try { run(3); console.log(run.name + " no error"); } catch (e) { console.log(run.name + " " + e.constructor.name + " " + String(e.stack).split("\n").slice(1, 2).join("").replace(/.*:(\d+:\d+)\)/, "$1")); } }
function fail() {}
show(function uses1() { const c = void 0 + 1; const e = c ?? c; return e(); });
show(function uses2() { fail(); const a = 2.5; const b = -a; let c = b ?? b; c(); });
show(function uses3() { let a = 2n; let b = a ?? a; return (typeof b)(); });
show(function uses4() { let a = 2.5; let b = a ? 0n : a; return (!b)(); });
show(function uses5() { let a = void 0; let b = a && a; return b(); });
show(function uses6() { let a = 1; let b = NaN ?? a; let c = a !== b; return (typeof c)(); });
show(function twice1() { let a = "5"; const b = a.length; return 1 instanceof b; });
show(function twice2() { fail(); const a = "5"; const b = `${a}y`; const c = typeof b; return (1 + c)(); });
show(function twice3() { fail(); let a = void 0; let b = `${a}y`; let c = !b; return ("t" + c)(); });
show(function order1() { let a = undefined; let b = 2n; let c = a && b; return ("t" + c)(); });
show(function order2() { fail(); const a = 2.5; const b = null ? a : a; const c = "".length; throw c(); });
show(function truth2() { const a = false; const b = a; const c = b <= -3; const d = !c; const e = d ?? "y"; throw e(); });
show(function joins1() { fail(); const a = Infinity; const b = false > a; const c = b + "y"; const d = c + 1; const e = d + undefined; return ("t" + e)(); });
show(function joins4() { { const a = "é"; const b = +a; const c = "5" + b; const d = c + ""; const e = d + "y"; return `${e}`(); } });
