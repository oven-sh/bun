// A generator declared to be sent numbers is sent a text and nothing. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
function* g38(): Generator<number, unknown, number> { const a = yield 1; const b = yield 2; return [a + 1, b * 2, typeof a]; }
const it38 = g38(); it38.next(); it38.next(5); show(it38.next(6).value); const jt = g38(); jt.next(); (jt as Generator<number, unknown, unknown>).next("text"); show((jt.next as () => IteratorResult<number, unknown>)().value);
export {};
