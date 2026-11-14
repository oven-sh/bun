// Instances of a class, and of a class below a mixin.
class Alone { constructor(row, width) { this.row = row; this.width = width; } get(i) { return this.row[i & 3]; } set(i, value) { this.row[i & 3] = value; return this; } }
function mix(Base) { if (Base === undefined) Base = Object; class Mixed extends Base { first() { return this.get(0); } } return Mixed; }
class Below extends mix() { constructor(row, width) { super(); this.row = row; this.width = width; } get(i) { return this.row[i & 3]; } set(i, value) { this.row[i & 3] = value; return this; } }
class Plain { constructor() { this.plain = 1; } }
class BelowClass extends mix(Plain) { constructor(row, width) { super(); this.row = row; this.width = width; } get(i) { return this.row[i & 3]; } set(i, value) { this.row[i & 3] = value; return this; } }
class List extends Array { constructor(width) { super(4); for (let i = 0; i < 4; i++) this[i] = [0.5, i]; this.width = width; } get(i, j) { return this[i][j]; } set(i, j, value) { this[i][j] = value; return this; } }
class BelowArray extends mix(Array) { constructor(width) { super(4); for (let i = 0; i < 4; i++) this[i] = [0.5, i]; this.width = width; } get(i, j) { return this[i][j]; } set(i, j, value) { this[i][j] = value; return this; } }
const loops = {
  "a list": n => { const object = new List(4); let sum = 0; for (let i = 0; i < n; i++) { object.set(i & 3, 1, i & 7); sum += object.get(i & 3, 1) + object.width; } return sum; },
  "a list below a mixin of Array": n => { const object = new BelowArray(4); let sum = 0; for (let i = 0; i < n; i++) { object.set(i & 3, 1, i & 7); sum += object.get(i & 3, 1) + object.width; } return sum; },
  "a class": n => { const object = new Alone(new Array(4).fill(1), 4); let sum = 0; for (let i = 0; i < n; i++) { object.set(i, i & 7); sum = (sum + object.get(i + 1) + object.width) | 0; } return sum; },
  "a class below a mixin of Object": n => { const object = new Below(new Array(4).fill(1), 4); let sum = 0; for (let i = 0; i < n; i++) { object.set(i, i & 7); sum = (sum + object.get(i + 1) + object.width) | 0; } return sum; },
  "a class below a mixin of a class": n => { const object = new BelowClass(new Array(4).fill(1), 4); let sum = 0; for (let i = 0; i < n; i++) { object.set(i, i & 7); sum = (sum + object.get(i + 1) + object.width) | 0; } return sum; },
};
const [, loop, iterations] = process.argv.slice(2);
if (loop === undefined) for (const name of Object.keys(loops)) console.log(name, loops[name](40));
else console.log(loops[loop](Number(iterations)));
