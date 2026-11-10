// The name is laid late: on the prototype object of the middle function, of the lowest, on one instance, as an accessor, and taken away again; and the topmost's own is replaced and deleted.
const unseen = x => [x][JSON.parse("0")];
function Top(x) { this.x = x; }
Top.prototype.sum = function () { return this.x + 1; };
function Mid(x) { this.x = x; }
Object.setPrototypeOf(Mid.prototype, Top.prototype);
function Low(x) { this.x = x; }
Object.setPrototypeOf(Low.prototype, Mid.prototype);
Low.prototype.twice = function () { return this.sum() + this.sum(); };
function run(count) { let total = 0; for (let i = 0; i < count; i++) total += new Low(i & 3).twice(); return total; }
const kept = new Low(5), marked = new Low(6);
const show = () => console.log(run(unseen(8)), kept.twice(), marked.twice());
show();
marked.sum = function () { return -1; };
show();
Mid.prototype.sum = function () { return this.x + 10; };
show();
Low.prototype[unseen("sum")] = function () { return this.x + 20; };
show();
delete Low.prototype.sum;
show();
delete Mid.prototype.sum;
delete marked.sum;
show();
Object.defineProperty(Mid.prototype, "sum", { get() { return () => 1000; }, configurable: true });
show();
delete Mid.prototype.sum;
Top.prototype.sum = function () { return this.x + 2; };
show();
delete Top.prototype.sum;
try { show(); } catch (error) { console.log(error.constructor.name); }
