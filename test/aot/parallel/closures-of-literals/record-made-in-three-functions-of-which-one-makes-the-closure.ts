type Span = { kind: string; attributes?: object; isExpected?: (e: unknown) => boolean };
const spans: Span[] = [];
function start(name: string, o: Span) { spans.push(o); return name + o.kind; }
async function wrap(name: string, o: Span, f: () => unknown) { spans.push(o); try { return await f(); } catch (e) { return o.isExpected?.(e) ? "expected" : "thrown"; } }
async function compact() { await null; return start("c", { kind: "1" }); }
async function other() { await null; return start("o", { kind: "2", attributes: {} }); }
async function call(id: number) { let wanted = 0; wanted = id; await null; return wrap("w", { kind: "3", isExpected: e => e === wanted++ }, () => { throw id; }); }
Promise.all([compact(), other(), call(7)]).then(all => console.log(all.join(), spans.length));
