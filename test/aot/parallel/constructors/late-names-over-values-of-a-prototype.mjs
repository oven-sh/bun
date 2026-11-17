function typed(list, kind) { try { switch (kind) { case "uint8": return new Uint8Array(list); case "int32": return new Int32Array(list); default: throw 1; } } catch (error) { return list; } }
function Machine(starts) { this.at = 0; this.sum = 0; this.ticks = 0; if (starts) this.start(); }
Machine.prototype.TICKS = [4, 12, 8, 8, 4, 4, 8, 4];
Machine.prototype.NAMES = ["a", "b", "c", "d"];
Machine.prototype.SIZE = 7;
Machine.prototype.OPS = [function (m) { m.sum += 1; }, function (m) { m.sum = (m.sum * 3) & 0xffff; }, function (m) { m.at = (m.at + 2) & 7; }, function (m) { m.sum ^= m.ticks; }];
Machine.prototype.start = function () { this.TICKS = typed(this.TICKS, "uint8"); this.NAMES = this.NAMES.slice(1); this.SIZE = 9; };
Machine.prototype.run = function (turns) { for (var i = 0; i < turns; i++) { this.ticks += this.TICKS[this.at]; this.OPS[this.at & 3](this); this.at = (this.at + 1) & 7; } return [this.sum, this.ticks, this.at, this.SIZE, this.NAMES.join("")].join(); };
globalThis.seen = [Machine, findValue("machine")];
const started = new Machine(true), waits = new Machine(false);
for (let i = 0; i < 40; i++) started.run(20);
console.log(started.run(50), Object.keys(started).join());
console.log(waits.run(50), Object.keys(waits).join(), waits.hasOwnProperty("TICKS"), "TICKS" in waits, waits.TICKS === Machine.prototype.TICKS);
waits.start();
console.log(waits.run(50), Object.keys(waits).join(), waits.TICKS instanceof Uint8Array);
delete waits.TICKS;
console.log(waits.run(50), waits.TICKS.length, waits.hasOwnProperty("TICKS"));
Machine.prototype.TICKS = [1, 2, 3, 4, 5, 6, 7, 8];
console.log(waits.run(50), started.run(50));
waits.TICKS = undefined;
try { console.log(waits.run(2)); } catch (error) { console.log(error instanceof TypeError); }
const other = new Machine(false);
other.TICKS = Int32Array.of(9, 8, 7, 6, 5, 4, 3, 2);
console.log(other.run(50), Object.keys(other).join());
Machine.prototype.SIZE = 100;
console.log(new Machine(false).run(3), started.run(3));
function findValue(name) { return globalThis[name]; }
