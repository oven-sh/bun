// An array has a named property of its own, and Array.prototype gets a property with the same name afterwards. The own property still wins, before and after a collection.
// Env of the executable: BUN_JSC_validateAOTRuntime=1
function read(a) { return a.c; }
function call(a) { try { return a.c(); } catch (error) { return error.constructor.name; } }
const own = [2, "text"]; own.c = { inner: 1 };
const bare = [1, 2];
console.log(read(own).inner, read(bare), "c" in own, "c" in bare);
Array.prototype.c &= 7;
Bun.gc(true);
console.log(read(own).inner, read(bare), own.length, [].c, "c" in bare);
Array.prototype.c = function () { return "prototype " + this.length; };
Bun.gc(true);
console.log(call(own), call(bare), Object.keys(own).join(), own.map(x => x).c === Array.prototype.c);
const late = [3]; late.c = () => "own";
Bun.gc(true);
console.log(call(late), JSON.stringify(late), [...late].length);
delete own.c;
console.log(call(own));
delete Array.prototype.c;
Bun.gc(true);
console.log(call(own), call(late), read(bare));
