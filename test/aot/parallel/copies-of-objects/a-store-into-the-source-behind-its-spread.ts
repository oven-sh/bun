type Source = { a: number; b: number };
function use(s: Source, k: number): string { const copy = { ...s }; let thrown = "none"; try { s.a = k; } catch (error) { thrown = (error as Error).name; } return JSON.stringify(copy) + " " + thrown + " " + s.a; }
function useAssign(s: Source, k: number): string { const copy = Object.assign({ z: k }, s); let thrown = "none"; try { s.b = k; } catch (error) { thrown = (error as Error).name; } return JSON.stringify(copy) + " " + thrown + " " + s.b; }
const open: Source = { a: 1, b: 2 }, frozen: Source = Object.freeze({ a: 1, b: 2 }), sealed: Source = Object.seal({ a: 1, b: 2 });
(globalThis as any).kept = [open, frozen, sealed];
for (let k = 5; k < 8; k++) console.log(use(open, k), use(frozen, k), use(sealed, k), useAssign(open, k), useAssign(frozen, k), useAssign(sealed, k));
