// A text that is evaluated is a script, also in a module: `await` is a name there. A function of the module may be replaced.
globalThis.local = "global";
const show = (name, made) => console.log(name, typeof made === "function" ? made({ await: 4 }) : made);
function variable() { const local = "own"; return eval("(function () { var await = 5; return local + await; })"); }
function parameter() { const local = "own"; return eval("(function (await) { return local + typeof await; })"); }
function pattern() { const local = "own"; return eval("(function ({ await }) { return local + await; })"); }
function ownName() { const local = "own"; return eval("(function await() { return local; })"); }
function label() { const local = "own"; return eval("(function () { await: for (;;) break await; return local; })"); }
function arrow() { const local = "own"; return eval("((await) => local + typeof await)"); }
const innerArrow = () => { const local = "own"; return eval("(await => local + typeof await)"); };
async function inAsync() { const local = "own"; return eval("(await => local + typeof await)"); }
class Methods { method() { const local = "own"; return eval("(function () { let await = 6; return local + await; })"); } static { const local = "block"; this.made = eval("(function () { let await = 7; return local + await; })"); } }
for (const make of [variable, parameter, pattern, ownName, label, arrow, innerArrow]) show(make.name, make());
show("method", new Methods().method());
show("block", Methods.made);
inAsync().then(made => show("inAsync", made));
export function make() { return "(function () { return 1; })"; }
const use = () => { const made = eval(make()); return made(); };
const replace = text => eval(text);
show("before", use());
replace(process.argv.length > 0 ? "make = () => '(function () { return 2; })'" : "");
show("after", use());
export function spread(local) { const parts = ["(function () { return local; })"]; return eval(...parts); }
show("spread", spread(8));
