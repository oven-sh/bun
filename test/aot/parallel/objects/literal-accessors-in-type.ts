// Object literals with getters and setters that are used through annotated types.
declare const console: any;
function line(name: string, f: () => unknown) { try { console.log(name, JSON.stringify(f())); } catch (e: any) { console.log(name, "THREW", e.constructor.name, String(e.message).slice(0, 60)); } }
line("door 1: annotated", () => { const g: { x: number } = { get x() { return 5; } }; return g.x; });
line("door 1: readonly", () => { const g: { readonly x: number } = { get x() { return 2; } }; return g.x; });
line("door 1: pair", () => { let kept = 1; const g: { x: number } = { get x() { return kept; }, set x(v: number) { kept = v * 2; } }; g.x = 4; return [g.x, kept]; });
line("door 1: setter only", () => { let kept = 1; const g: { x: number } = { set x(v: number) { kept = v; } } as any; g.x = 4; return [kept]; });
line("door 1: two getters", () => { const g: { x: number; y: string } = { get x() { return 5; }, get y() { return "s"; } }; return [g.x, g.y, Object.keys(g)]; });
function made(): { x: number } { return { get x() { return 6; } }; }
line("door 1: returned", () => made().x);
function taken(p: { x: number }) { return p.x; }
line("door 1: argument", () => taken({ get x() { return 7; } }));
line("door 1: this", () => { const g: { x: number } = { get x(): number { return Object.keys(this).length; } }; return g.x; });
line("door 1: twice", () => { const f = (n: number): { x: number } => ({ get x() { return n; } }); return [f(1).x, f(2).x]; });
line("door 1: in a field", () => { const o: { inner: { x: number } } = { inner: { get x() { return 8; } } }; return o.inner.x; });
line("door 1: in an array", () => { const a: { x: number }[] = [{ get x() { return 9; } }, { x: 10 }]; return a.map(e => e.x); });
line("control: data beside", () => { const g: { x: number; d: number } = { d: 1, get x() { return 5; } }; return [g.x, g.d]; });
line("control: method beside", () => { const g: { x: number; m(): number } = { m() { return 1; }, get x() { return 5; } }; return [g.x, g.m()]; });
line("control: no annotation", () => { const g = { get x() { return 5; } }; return g.x; });
line("door 2: own type first", () => { const own = { w: 1, get g() { return 2; } }; const read = (p: { g: number }) => p.g; return read(own); });
line("door 2: names the data field", () => { const own = { w: 1, get g() { return 2; } }; const read = (p: { w: number; g: number }) => p.g + p.w; return read(own); });
line("door 2: accessors only", () => { const own = { get g() { return 2; } }; const read = (p: { g: number }) => p.g; return read(own); });
line("door 2: two literals, one shape", () => { const a = { w: 1, get g() { return "a"; } }, b = { w: 1, get g() { return "b"; } }; const read = (p: { g: string }) => p.g; return [read(a), read(b)]; });
line("door 2: assigned", () => { const own = { get g() { return 2; } }; const seen: { g: number } = own; return seen.g; });
