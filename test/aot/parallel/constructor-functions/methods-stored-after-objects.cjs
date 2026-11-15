// new Big(1); install = function (f) { Big.prototype.am = f; }; install(am1): the method is stored when objects exist. Its guard begins there, unless something else touched the name.
var install, installLate;
function Big(v) { this.v = v; this.list = [v]; }
Big.prototype.get = function () { return this.v; };
function am1(x) { var s = 0; for (var i = 0; i < 3; i++) s += x + i; return s + this.v; }
function am2(x) { return x * 2 - this.get(); }
function own(x) { return "own" + x; }
const early = new Big(1);
install = function (f) { Big.prototype.am = f; };
install(am1);

function Hidden(v) { this.v = v; }
const hidden = new Hidden(2);
hidden.run = own;
installLate = function (f) { Hidden.prototype.run = f; };
function run1(x) { return x + this.v; }
installLate(run1);

function Other(v) { this.v = v; }
const other = new Other(3);
const store = f => { Other.prototype.run = f; };
function run2(x) { return x - this.v; }
store(am2);
store(run2);

function Gone(v) { this.v = v; }
const gone = new Gone(4);
Gone.prototype.run = own;
delete Gone.prototype.run;
const put = f => { Gone.prototype.run = f; };
put(run1);

const objects = [early, new Big(5), new Big(6)];
const runners = [hidden, new Hidden(7), other, new Other(8), gone, new Gone(9)];
const said = [];
function ask() {
  let s = "";
  for (let i = 0; i < 24; i++) {
    for (const o of objects) { try { s += o.am(i) + ","; } catch (e) { s += e.constructor.name + ","; } }
    for (const o of runners) { try { s += o.run(i) + ","; } catch (e) { s += e.constructor.name + ","; } }
  }
  said.push(s);
}
ask();
install(am2);
ask();
install(am1);
ask();
objects[1].am = own;
ask();
delete Big.prototype.am;
ask();
install(am1);
Object.defineProperty(Hidden.prototype, "run", { get() { return run2; }, configurable: true });
Object.setPrototypeOf(runners[3], Big.prototype);
Object.freeze(Gone.prototype);
try { "use strict"; put(run2); } catch (e) { said.push(e.constructor.name); }
ask();
console.log(said.join("\n"));
