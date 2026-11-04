let shell, tick, threw = "no";
try { shell = new Bun.$`echo made`; } catch (e) { threw = e.constructor.name; }
try { tick = new process.nextTick(() => console.log("the tick runs")); } catch (e) { threw += " " + e.constructor.name; }
function later() { return [typeof shell, typeof tick, Object.prototype.toString.call(tick)].join(); }
console.log(later(), threw);
