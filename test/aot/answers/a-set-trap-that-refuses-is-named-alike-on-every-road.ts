// answers: without-library
// # A store that returns files its pair, a store that throws does not. So one statement goes by the run time's own road first (ProxyObject::performPut()) and by the stub's road later (ProxyObject::finishSet()).
// # Both name the key alike. When the stub's road wrote 'Symbol(Symbol.iterator)' where the other writes 'Symbol.iterator', the text of the TypeError hung on what the caches held.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 15 of 15 of 15
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): unknown;
function store(o: any, k: symbol, v: number): string { try { o[k] = v; return "stored"; } catch (e: any) { return e.message; } }
function picky(): any { return new Proxy(function () {}, { set(target: object, key: string | symbol, value: number) { return value !== 2; } }); }
const values = [2, 2, 1, 1, 1, 2, 2];
const made = Symbol("made");
for (let i = 0; i < values.length; i++) report(store(picky(), Symbol.iterator, values[i]));
for (let i = 0; i < values.length; i++) report(store(picky(), made, values[i]));
report("end");
