// An object of a class takes elements: a collection that counts its own length, a vector under 0, 1 and 2. A store by index goes by the short way of elements, as on an object of a literal,
// and not through descriptors. What the short way cannot answer stays the long road's: objects that are closed, sealed or frozen, elements with attributes, setters and read-only elements above.
// COUNT: counter:ElementsStoredByDescriptors <= 60
class Query {
  constructor(list) { this.length = 0; for (let i = 0; i < list.length; i++) this.push(list[i]); }
  push(x) { this[this.length++] = x; return this; }
  sum() { let s = 0; for (let i = 0; i < this.length; i++) s += this[i]; return s; }
}
class Vector { constructor(x, y, z) { this[0] = x; this[1] = y; this[2] = z; } dot(o) { return this[0] * o[0] + this[1] * o[1] + this[2] * o[2]; } }
class Below extends Vector { constructor(x) { super(x, x, x); this[3] = "four"; } }
const data = [3, 1, 4, 1, 5, 9, 2, 6];
let sum = 0;
for (let t = 0; t < 2000; t++) { sum += new Query(data).sum() + new Vector(t, 2, 3).dot(new Vector(1, t & 3, 2)) + new Below(t & 7)[3].length; }
console.log(sum);

const q = new Query(data); q[2] = "again"; q[20] = "far"; q.name = "kept"; q[9] = 0.5;
console.log(JSON.stringify(q), Object.keys(q).join(), q.length, 20 in q, 19 in q, JSON.stringify(Object.getOwnPropertyDescriptor(q, 2)));
delete q[2]; q[2] = "anew"; console.log(Object.keys(q).join(), q[2]);
q[4294967294] = "the last index"; q[4294967295] = "no index"; q[-1] = "no index either"; q["07"] = "a name";
console.log(Object.keys(q).join());

function tell(name, o, index, value) {
  "use strict";
  try { o[index] = value; console.log(name, "stored", JSON.stringify(Object.getOwnPropertyDescriptor(o, index)), Object.keys(o).join()); }
  catch (e) { console.log(name, e.constructor.name, e.message, JSON.stringify(Object.getOwnPropertyDescriptor(o, index))); }
}
tell("closed, new", Object.preventExtensions(new Vector(1, 2, 3)), 3, 9);
tell("closed, there", Object.preventExtensions(new Vector(1, 2, 3)), 1, 9);
tell("sealed, new", Object.seal(new Vector(1, 2, 3)), 3, 9);
tell("sealed, there", Object.seal(new Vector(1, 2, 3)), 1, 9);
tell("frozen, there", Object.freeze(new Vector(1, 2, 3)), 1, 9);
tell("read-only", Object.defineProperty(new Vector(1, 2, 3), 1, { value: 7, writable: false }), 1, 9);
tell("hidden", Object.defineProperty(new Vector(1, 2, 3), 1, { value: 7, enumerable: false, writable: true }), 1, 9);
const told = [];
tell("own setter", Object.defineProperty(new Vector(1, 2, 3), 5, { set(v) { told.push("own " + v); }, configurable: true }), 5, 9);

class Member { 5() { return "the method"; } call() { return this[5](); } }
const member = new Member(); console.log(member.call(), new Member().call());
member[5] = () => "its own"; console.log(member.call(), new Member().call(), Object.keys(member).join());

class Watched { constructor() { this.n = 1; } }
const early = new Watched(); early[0] = "early";
Object.defineProperty(Watched.prototype, 1, { set(v) { told.push("above " + v); }, configurable: true });
const late = new Watched(); late[0] = "zero"; late[1] = "one"; early[1] = "one too";
console.log(Object.keys(late).join(), Object.keys(early).join(), told.join());
class Above {} class Under extends Above { constructor() { super(); this.n = 1; } }
tell("before anything lies above", new Under(), 2, 8);
Object.defineProperty(Above.prototype, 2, { value: "locked above", writable: false, configurable: true });
tell("below a read-only element", new Under(), 2, 9);
delete Above.prototype[2];
tell("behind its removal", new Under(), 2, 9);
const heir = Object.create(new Vector(1, 2, 3)); heir[1] = "on the heir"; console.log(Object.keys(heir).join(), heir[0], heir[1], Object.getPrototypeOf(heir)[1]);
