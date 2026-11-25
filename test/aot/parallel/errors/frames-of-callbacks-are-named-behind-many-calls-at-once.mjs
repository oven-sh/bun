// A callback that leaves sight writes down, where it is entered, which function object it was entered through. The names in a stack follow what the function objects are called when the stack is read:
// behind frames that were left, behind hundreds of such calls at once, for which the list of records grows, and up to the end of the stack.
const names = error => error.stack.split("\n").slice(1, 6).map(line => line.trim().replace(/\(.*\)|(?:[A-Za-z]:)?[\\/].*$/g, "").trim()).join(" < ");
function overwrite(depth) { const a = [depth, depth + 1, depth + 2]; return depth ? overwrite(depth - 1) + a.length : 0; }
const kept = [];
function sync(list) { let seen = 0; list.forEach(function each(item) { seen++; kept.push(new Error("sync " + item)); }); return seen; }
function arrows(list) { let seen = 0; list.map(x => { seen += x; kept.push(new Error("arrow " + x)); return x; }); return seen; }
function thrower(list) { list.forEach(function throwing(item) { throw new Error("thrown " + item); }); }
function caughtFurtherUp(list) { try { thrower(list); } catch (error) { kept.push(error); } }
async function acrossAwait(list) { let seen = 0; const each = function awaited(item) { seen++; kept.push(new Error("await " + item)); }; list.forEach(each); await null; list.forEach(each); await new Promise(r => setTimeout(r, 1)); list.forEach(each); return seen; }
function* inGenerator(list) { let seen = 0; const each = function yielded(item) { seen++; kept.push(new Error("yield " + item)); }; list.forEach(each); yield seen; list.forEach(each); yield seen; }
function keptByHost(list) { return new Promise(resolve => { let seen = 0; setTimeout(function later() { list.forEach(function inTimer(item) { seen++; kept.push(new Error("timer " + item)); }); resolve(seen); }, 1); }); }
function renamedLater(list, hook) { const made = []; list.forEach(item => { const each = function each(depth) { if (depth) return each(depth - 1); kept.push(new Error("renamed " + item)); }; made.push(each); hook(each); each(item); }); return made; }
const hide = new Function("f", "return f");
const list = JSON.parse("[1,2]");
console.log(sync(list), arrows(list));
caughtFurtherUp(list);
console.log(await acrossAwait(list));
for (const seen of inGenerator(list)) { overwrite(2000); console.log("generator", seen); }
console.log(await keptByHost(list));
const made = renamedLater(list, hide);
overwrite(2000);
new Function("made", "made[0].displayName = 'shown'; Object.defineProperty(made[1], 'name', { value: 'renamed' });")(made);
overwrite(2000);
for (const error of kept) console.log(error.message, "|", names(error));
function nest(depth, f) { return depth ? [depth].map(d => nest(d - 1, f))[0] : f(); }
console.log(nest(300, () => names(new Error("deep"))));
let reached = 0;
function fill() { reached++; [0].forEach(fill); }
try { fill(); } catch (error) { console.log(error instanceof RangeError, reached > 1000); }
let again = 0;
const spin = () => { again++; hide(spin)(); };
try { spin(); } catch (error) { console.log(error instanceof RangeError, again > 1000); }
console.log("done", kept.length);
