declare function fn(): boolean; declare const pr: Promise<boolean>; declare const obj: { f(): void; a: number };
enum E { A = 0, B = 1 }
if (fn) {} if (pr) {} if (E.A) {} if (obj.f) {} if (obj.f) { obj.f(); } if (fn);
do {} while (fn);
for (let i = 0, j; i < 1; i++) {}
for (var { a } in obj) {}
for (const k: string in obj) {}
for (obj.a in 1) {}
switch (1 as number) { case "x": break; default: default: }
lbl: lbl: for (;;) { continue nope; }
try { throw
  1; } catch (e: number) { let e = 1; } finally {}
try {} catch ({ x } = 1) {}
function r(): number { return; }
class Z { set s(v: number) { return 1; } constructor() { return 1; } static { return; } }
break;
return 1;
function nr(): never {}
function nv(): number { if (fn()) return 1; }
