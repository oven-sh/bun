// Flags: --aot-validate
// A generator makes a list, yields, reads the list, hands it to a function that changes it, and reads it again.
function clobber(n) { let a = n, b = n * 2, c = [n], d = { n }; if (n > 0) return clobber(n - 1) + a + b + c[0] + d.n; return 0; }
function churn() { const junk = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "x" + i, l: [i, i] }); clobber(200); if (typeof Bun !== "undefined") Bun.gc(true); return junk.length; }
function show(...values) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
function* g(n, change) { for (let i = 0; i < n; i++) { const d = []; d.push(i + 1); yield 0; const before = d[0]; change(d); const after = d[0]; yield [before, after, d.length]; } } function run(change) { const out = []; for (const x of g(3, change)) if (x) out.push(x); return out; }
const out = [];
try { out.push('store', run(l => { l[0] = 'changed'; })); } catch (e) { out.push('store', 'threw ' + e.constructor.name); }
try { out.push('empty', run(l => { l.length = 0; })); } catch (e) { out.push('empty', 'threw ' + e.constructor.name); }
try { out.push('accessor', run(l => { Object.defineProperty(l, 0, { get() { return 'got'; }, configurable: true }); })); } catch (e) { out.push('accessor', 'threw ' + e.constructor.name); }
try { out.push('delete-proto', run(l => { delete l[0]; Object.setPrototypeOf(l, { 0: 'proto', __proto__: Array.prototype }); })); } catch (e) { out.push('delete-proto', 'threw ' + e.constructor.name); }
try { out.push('double', run(l => { l[0] = 1.5; })); } catch (e) { out.push('double', 'threw ' + e.constructor.name); }
try { out.push('sparse', run(l => { l[100000] = 1; delete l[0]; })); } catch (e) { out.push('sparse', 'threw ' + e.constructor.name); }
try { out.push('unshift', run(l => { l.unshift('front'); })); } catch (e) { out.push('unshift', 'threw ' + e.constructor.name); }
try { out.push('text', run(l => { l[0] = 'text'; l.push({}); })); } catch (e) { out.push('text', 'threw ' + e.constructor.name); }
try { out.push('nothing', run(l => {})); } catch (e) { out.push('nothing', 'threw ' + e.constructor.name); }
Promise.resolve().then(() => setTimeout(() => show(out), 30));
