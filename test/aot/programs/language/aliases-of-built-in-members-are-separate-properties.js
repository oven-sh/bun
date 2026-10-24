// One function object under two names (trimRight and trimEnd, X.prototype.constructor and X) is two properties. Replacing one must not affect reads of the other. Every read is in a loop.
const strings = [" a ", " b ", " c "];
function right() { let r = ""; for (let i = 0; i < strings.length; i++) r += "[" + strings[i].trimRight() + "]"; return r; }
function end() { let r = ""; for (let i = 0; i < strings.length; i++) r += "[" + strings[i].trimEnd() + "]"; return r; }
function left() { let r = ""; for (let i = 0; i < strings.length; i++) r += "[" + strings[i].trimLeft() + "]"; return r; }
function start() { let r = ""; for (let i = 0; i < strings.length; i++) r += "[" + strings[i].trimStart() + "]"; return r; }
function all(label) { console.log(label, right(), end(), left(), start()); }

all("untouched");
String.prototype.trimRight = function () { return "mine"; };
all("trimRight replaced");
// The compiler cannot tell which property this store writes.
const made = ["trim", "Left"].join("");
String.prototype[made] = function () { return "made"; };
all("trimLeft replaced by a made name");
String.prototype.trimEnd = function () { return "end"; };
all("trimEnd replaced");

function numberParse() { let r = 0; for (let i = 0; i < 3; i++) r += Number.parseFloat("1.5") + Number.parseInt("7px"); return r; }
function globalParse() { let r = 0; for (let i = 0; i < 3; i++) r += parseFloat("1.5") + parseInt("7px"); return r; }
console.log("parse", numberParse(), globalParse());
Number.parseFloat = function () { return 100; };
console.log("Number.parseFloat replaced", numberParse(), globalParse());
globalThis.parseInt = function () { return 1000; };
console.log("parseInt replaced", numberParse(), globalParse());

function constructorsOf(list) { let r = ""; for (let i = 0; i < list.length; i++) r += list[i].constructor.name + ","; return r; }
const controllers = [new AbortController(), new AbortController()];
const collators = [new Intl.Collator("en"), new Intl.Collator("de")];
console.log("constructors", constructorsOf(controllers), constructorsOf(collators));
AbortController.prototype.constructor = function Planted() {};
Intl.Collator.prototype.constructor = function AlsoPlanted() {};
console.log("constructors replaced", constructorsOf(controllers), constructorsOf(collators));
function direct() { let r = ""; for (let i = 0; i < 2; i++) r += AbortController.prototype.constructor.name + "," + Intl.Collator.prototype.constructor.name + ","; return r; }
console.log("read from the prototypes", direct(), AbortController.name, Intl.Collator.name);

function dispose(stacks) { let r = ""; for (let i = 0; i < stacks.length; i++) r += String(stacks[i][Symbol.dispose]()) + "," + String(stacks[i].dispose()) + ";"; return r; }
console.log("dispose", dispose([new DisposableStack(), new DisposableStack()]));
DisposableStack.prototype[Symbol.dispose] = function () { return "by symbol"; };
console.log("[Symbol.dispose] replaced", dispose([new DisposableStack(), new DisposableStack()]));
{
  using stack = new DisposableStack();
  stack.defer(() => console.log("deferred ran"));
}
console.log("behind using");

const buffers = require("node:buffer");
function bufferNames() { let r = ""; for (let i = 0; i < 2; i++) r += buffers.Buffer.name + "," + Buffer.name + ";"; return r; }
console.log("node:buffer", bufferNames());
buffers.Buffer = function OtherBuffer() {};
console.log("node:buffer's Buffer replaced", bufferNames());
