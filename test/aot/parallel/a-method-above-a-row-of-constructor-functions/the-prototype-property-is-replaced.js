// The `prototype` property of the topmost, of the middle and of the lowest function is replaced late: old objects keep the old row, new ones take the new one.
const unseen = x => [x][JSON.parse("0")];
function Top(x) { this.x = x; }
Top.prototype.sum = function () { return this.x + 1; };
function Mid(x) { this.x = x; }
Object.setPrototypeOf(Mid.prototype, Top.prototype);
function Low(x) { this.x = x; }
Object.setPrototypeOf(Low.prototype, Mid.prototype);
Low.prototype.twice = function () { return this.sum() + this.sum(); };
function run(count) { let total = 0; for (let i = 0; i < count; i++) total += new Low(i & 3).twice(); return total; }
const kept = new Low(5);
const show = () => console.log(run(unseen(8)), kept.twice(), kept instanceof Top, kept instanceof Mid, kept instanceof Low, new Low(1) instanceof Top);
show();
Top.prototype = { sum() { return this.x + 50; } };
show();
Mid.prototype = Object.create(Top.prototype);
show();
const old = Low.prototype;
Low.prototype = Object.create(Mid.prototype, { twice: { value: old.twice } });
show();
Low.prototype = old;
show();
