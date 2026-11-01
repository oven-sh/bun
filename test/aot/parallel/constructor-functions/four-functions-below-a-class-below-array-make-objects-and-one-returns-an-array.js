class List extends Array {
  first() { return this[0]; }
}
function ByLink() {}
Object.setPrototypeOf(ByLink.prototype, List.prototype);
function ByProto() {}
ByProto.prototype.__proto__ = List.prototype;
function Returns() { return Reflect.construct(List, [], new.target); }
Returns.prototype = Object.create(List.prototype);
function Stores(n) { this[0] = n; this.length = 1; }
Stores.prototype = Object.create(List.prototype, { constructor: { value: Stores } });
function say(tag, a) {
  console.log(tag, Array.isArray(a), a.length, a.push(3), a.length, a.first(), JSON.stringify(a), a.slice(0).length, a.map(x => x).constructor.name, a.indexOf(3), a.includes(3), [...a].length, a.at(-1));
}
say("link", new ByLink());
say("proto", new ByProto());
say("returns", new Returns());
say("stores", new Stores(9));
let t = 0;
for (let i = 0; i < 6000; i++) {
  const a = [new ByLink(), new ByProto(), new Returns(), new Stores(i), new List()][i % 5];
  a[1] = i;
  for (const x of a) t += x ?? 1;
  t += a.length + (Array.isArray(a) ? 7 : 0) + a.push(1);
  const [one, two] = a;
  t += (one ?? 0) + (two ?? 0);
  a.length = 0;
  t += a.length + Object.keys(a).length;
}
console.log(t);
