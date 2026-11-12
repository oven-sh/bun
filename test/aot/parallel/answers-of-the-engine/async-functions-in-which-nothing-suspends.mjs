// An async function in which nothing suspends runs to its end at the call and hands back a promise. If the promise were settled at another moment, a throw left the call instead of rejecting, be it the first thing that the body does or on its way out through a finally, a thenable or a promise that is returned were handed on as it is, or the body ran later than the call, these would differ, the order of the notes above all.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
const order = [];
function note(what) { order[order.length] = what; }
async function number(n) { note("in number"); return n * 2; }
async function nothing() { note("in nothing"); }
async function thrower(n) { note("in thrower"); if (n > 0) throw "thrown " + n; return n; }
async function thenable(n) { return { then(resolve) { note("then is asked"); resolve(n + 1); } }; }
async function promise(n) { return number(n); }
async function rejected() { return thrower(1); }
async function withDefault(n = note("default") || 5) { return n; }
async function badDefault(n = missing.name) { return n; }
async function usesThis() { return this.w; }
async function counts() { return arguments.length; }
async function loops(n) { let sum = 0; for (let i = 0; i < n; i++) { sum += i; } return sum; }
async function tries(n) { try { if (n) throw "inside"; return "no throw"; } catch (error) { return "caught " + error; } finally { note("finally"); } }
async function atOnce() { throw "at once"; }
async function leaves(n) { try { throw "through " + n; } finally { note("finally on the way out"); } }
async function returnsFromFinally() { try { throw "lost"; } finally { return "from finally"; } }
async function waits(n) { const first = await number(n); return first + (await number(1)); }
const arrow = async n => n + 0.5;
class Holder { constructor(w) { this.w = w; } async read() { return this.w; } static async make(w) { return new Holder(w); } }
const byValue = [number, arrow, thrower];
const started = number(1);
note("behind the call");
report(typeof started);
report(started === number(1));
report(await started);
report(await nothing());
try { await thrower(2); report("no throw"); }
catch (error) { report(error); }
report(await thrower(0));
const willReject = thrower(3);
note("no throw at the call");
try { await willReject; }
catch (error) { report(error); }
report(await thenable(1));
report(await promise(4));
try { await rejected(); }
catch (error) { report(error); }
report(await withDefault());
report(await withDefault(6));
try { await badDefault(); report("no throw"); }
catch (error) { report(typeof error); }
report(await ({ w: 3, usesThis }).usesThis());
report(await new Holder(7).read());
report((await Holder.make(8)).w);
report(await counts(1, 2, 3));
report(await loops(5));
report(await tries(0));
report(await tries(1));
try { await atOnce(); report("no throw"); }
catch (error) { report(error); }
const leaving = leaves(1);
note("behind the call that leaves");
try { await leaving; report("no throw"); }
catch (error) { report(error); }
report(await returnsFromFinally());
report(await waits(2));
report(await arrow(1));
for (let i = 0; i < 3; i++) { try { report(await byValue[i](i)); } catch (error) { report(error); } }
number(9).then(value => { note("then " + value); });
note("behind then");
await nothing();
await nothing();
for (let i = 0; i < order.length; i++) { report(order[i]); }
report("end");
