// What an instance finds by its constructor, beside the same class without a built-in or a mixin above it.
class Alone { constructor() { this.length = 2; } static isAlone(value) { return value != null && value.k === 1; } static get [Symbol.species]() { return this; } check(value) { return this.constructor.isAlone(value) ? 1 : 2; } kind(value) { return this.constructor[Symbol.species] === value ? 1 : 2; } }
class List extends Array { constructor() { super(2); } static isList(value) { return value != null && value.k === 1; } static get [Symbol.species]() { return this; } checkList(value) { return this.constructor.isList(value) ? 1 : 2; } listKind(value) { return this.constructor[Symbol.species] === value ? 1 : 2; } }
function mix(Base) { if (Base === undefined) Base = Object; class Mixed extends Base { static isMixed(value) { return value != null && value.k === 1; } checkMixed(value) { return this.constructor.isMixed(value) ? 1 : 2; } } return Mixed; }
const mixed = mix;
class Below extends mixed() { constructor() { super(); this.one = 1; } } class BelowArray extends mixed(Array) { }
function above() { } above.isAbove = value => value != null && value.k === 1;
function below() { } Object.setPrototypeOf(below, above);
class Rows extends Array { constructor(count, columns) { super(count); for (var i = 0; i < count; i++) { this[i] = new Array(columns); for (var j = 0; j < columns; j++) this[i][j] = i + j * 0.5 + 0.25; } this.rows = count; this.columns = columns; } get(i, j) { return this[i][j]; } at2(i, j) { return this[i][j]; } sumByGet(other) { var sum = 0; for (var i = 0; i < this.rows; i++) for (var j = 0; j < this.columns; j++) sum += other.get(i, j); return sum; } sumByAt2(other) { var sum = 0; for (var i = 0; i < this.rows; i++) for (var j = 0; j < this.columns; j++) sum += other.at2(i, j); return sum; } }
globalThis.rows = [new Rows(4, 16), new Rows(4, 16)];
globalThis.kept = [new Alone(), new Alone(), new List(), new List(), new Below(), new BelowArray(), above, below];
const value = { k: 1 };
const loops = {
  "statics of a class": n => { let sum = 0; for (let i = 0; i < n; i++) sum += globalThis.kept[i & 1].check(value); return sum; },
  "statics of a class that extends Array": n => { let sum = new List().length - 2; for (let i = 0; i < n; i++) sum += globalThis.kept[2 + (i & 1)].checkList(value); return sum; },
  "statics of a class that the loop does not name": n => { let sum = 0; for (let i = 0; i < n; i++) sum += globalThis.kept[2 + (i & 1)].checkList(value); return sum; },
  "species of a class": n => { let sum = 0; for (let i = 0; i < n; i++) sum += globalThis.kept[i & 1].kind(value); return sum; },
  "species of a class that extends Array": n => { let sum = new List().length - 2; for (let i = 0; i < n; i++) sum += globalThis.kept[2 + (i & 1)].listKind(value); return sum; },
  "statics of a class below a mixin": n => { let sum = new Below().one - 1; for (let i = 0; i < n; i++) sum += globalThis.kept[4].checkMixed(value); return sum; },
  "another instance, by a name of its own": n => { let sum = 0; for (let i = 0; i < n; i += 64) sum += globalThis.rows[0].sumByAt2(globalThis.rows[1]); return sum; },
  "another instance, by a name that built-ins have": n => { let sum = 0; for (let i = 0; i < n; i += 64) sum += globalThis.rows[0].sumByGet(globalThis.rows[1]); return sum; },
  "a property of a function": n => { let sum = 0; for (let i = 0; i < n; i++) sum += globalThis.kept[6].isAbove(value) ? 1 : 2; return sum; },
  "a property of the function above": n => { let sum = 0; for (let i = 0; i < n; i++) sum += globalThis.kept[7].isAbove(value) ? 1 : 2; return sum; },
};
const [, loop, iterations] = process.argv.slice(2);
if (loop === undefined) for (const name of Object.keys(loops)) console.log(name, loops[name](40));
else console.log(loops[loop](Number(iterations)));
