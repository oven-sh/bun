const unknown = JSON.parse('{"f":{"b":7},"z":0,"n":1,"k":"keys","set":"set","del":"delete"}');
const o = { a: 0 };
Object[unknown.k](o);
let s = 0;
for (let i = 0; i < 3000; i++) {
  const before = o.a | 0;
  o.a = i;
  o.b = i + 1;
  o.c = i + 2;
  o.d = i + 3;
  s = (s + before * 3 + (o.a | 0) + (o.d | 0)) % 1000003;
}
console.log(s | 0);
