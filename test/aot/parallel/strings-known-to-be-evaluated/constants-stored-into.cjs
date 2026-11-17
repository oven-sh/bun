// The evaluated text stores to a constant, and the store throws where the program comes to it.
const ofFile = 1, list = [];
var count = 0;
function never() { return eval("(function () { const a = 1; if (Math.abs(0)) a = 2; return a; })")(); }
function caught() { return eval("(function () { const a = 1; try { a = 2; } catch (error) { return error.name + a; } })")(); }
function besideOwn() { const own = 5; return eval("(function () { const a = own; try { a++; } catch (error) { return error.name + own; } })")(); }
function ofItsOwn() { const own = [5]; return eval("(function () { try { own = 6; } catch (error) { return error.name + own.push(1); } })")(); }
function ofTheFile() { let own = 2; const f = eval("(function () { list.push(own++); try { ofFile = 5; } catch (error) { return error.name + ofFile; } })"); return f() + f() + own + list; }
function counted() { const f = eval("(function () { count = 3; const a = 1; return function () { a += 2; }; })"); try { f()(); } catch (error) { return error.name + count; } }
function byPattern() { return eval("(function () { const a = 1; try { ({ a } = { a: 2 }); } catch (error) { return error.name + a; } })")(); }
function byLoop() { return eval("(function () { const a = 1; try { for (a of [3]) ; } catch (error) { return error.name + a; } })")(); }
function ofLoop() { return eval("(function () { try { for (const i = 0; i < 1; i++) count += 10; } catch (error) { return error.name + count; } })")(); }
function chosen() { return eval("(function () { const a = 1, b = null; a ||= 2; try { b ??= 3; } catch (error) { return error.name + a + b; } })")(); }
function early() { return eval("(function () { try { late = 1; } catch (error) { return error.name; } const late = 2; })")(); }
function* yielded() { const f = eval("(function* () { const a = 1; a = yield a; })"), steps = f(); yield steps.next().value; try { steps.next(); } catch (error) { yield error.name; } }
async function awaited() { const f = eval("(async function () { const a = 1; a = await 2; })"); try { await f(); } catch (error) { return error.name; } }
class Holder { #n = 4; at() { return eval("(o => { const a = this.#n; try { a = 1; } catch (error) { return error.name + o.#n + a; } })")(this); } }
const made = new Function("b", "const a = b; try { a = 2; } catch (error) { return error.name + a; }");
const ofScript = (0, eval)("(function () { const a = 4; try { a--; } catch (error) { return error.name + a; } })");
function refused() { try { return eval("(function () { let a = 1; let a = 2; })")(); } catch (error) { return error.name; } }
for (const f of [never, caught, besideOwn, ofItsOwn, ofTheFile, counted, byPattern, byLoop, ofLoop, chosen, early, refused]) console.log(f.name, f());
console.log([...yielded()].join(), new Holder().at(), made(7), ofScript());
awaited().then(console.log);
