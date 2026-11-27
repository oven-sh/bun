// Methods of prototypes, variables that they read and evals in one body.
function Counter(start) { this.value = start; this.step = STEP; }
Counter.prototype.next = function () { this.value += this.step * SCALE; return this.value; };
Counter.prototype.name = "counter";
var STEP = 2;
var SCALE = 10;
var text = process.argv.length > 100 ? "0" : "Counter.prototype.next.length + SCALE";
console.log(eval(text), new Function("return 6 * 7")(), Function("a", "return a + 1")(STEP));
Counter.prototype.twice = function () { return this.next() + this.next(); };
var LATE = eval("STEP + 1");
Counter.prototype.late = function () { return LATE; };
const counter = new Counter(1);
console.log(counter.next(), counter.twice(), counter.late(), counter.name);
eval("Counter.prototype.next = function () { return -1; }");
console.log(counter.next(), counter.twice());
function Other() { this.kind = KIND; }
eval("var KIND = 'made'");
Other.prototype.say = function () { return this.kind + WORD; };
console.log(new Other().say());
var WORD = "!";
console.log(new Other().say());
try { process.dlopen({ exports: {} }, text + ".missing"); } catch (error) { console.log(error instanceof Error); }
