// The prototype object of the middle function is linked below another one after the calls have run, and back again.
const unseen = x => [x][JSON.parse("0")];
function Top(x) { this.x = x; }
Top.prototype.sum = function () { return this.x + 1; };
function Other(x) { this.x = x; }
Other.prototype.sum = function () { return this.x + 100; };
function Mid(x) { this.x = x; }
Object.setPrototypeOf(Mid.prototype, Top.prototype);
function Low(x) { this.x = x; }
Object.setPrototypeOf(Low.prototype, Mid.prototype);
Low.prototype.twice = function () { return this.sum() + this.sum(); };
function run(count) { let total = 0; for (let i = 0; i < count; i++) total += new Low(i & 3).twice(); return total; }
const kept = new Low(5);
console.log(run(unseen(8)), kept.twice());
Object.setPrototypeOf(Mid.prototype, Other.prototype);
console.log(run(unseen(8)), kept.twice(), kept instanceof Top, kept instanceof Other);
Object.setPrototypeOf(Mid.prototype, Top.prototype);
console.log(run(unseen(8)), kept.twice(), kept instanceof Top, kept instanceof Other);
Object.setPrototypeOf(Mid.prototype, null);
try { console.log(run(unseen(1))); } catch (error) { console.log(error.constructor.name); }
