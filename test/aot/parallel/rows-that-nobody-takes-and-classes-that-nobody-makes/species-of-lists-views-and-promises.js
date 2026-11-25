class Rows extends Array {}
const rows = Rows.from([1, 2, 3]);
console.log(rows.map(x => x * 2) instanceof Rows, rows.filter(x => x > 1).constructor === Rows, rows.slice(1).length, rows.concat([4]) instanceof Rows);
class Bytes extends Uint8Array {}
console.log(new Bytes(4).subarray(1) instanceof Bytes, new Bytes([1, 2]).map(x => x + 1) instanceof Bytes, new Bytes(4).slice(2).length);
class Later extends Promise {}
console.log(Later.resolve(1).then(x => x) instanceof Later, Later.all([1]) instanceof Later);
class Plain extends Array { static get [Symbol.species]() { return Array; } }
console.log(new Plain(1, 2, 3).map(x => x) instanceof Plain, new Plain(1, 2, 3).map(x => x) instanceof Array);
