const unknown = JSON.parse('{"f":{"b":7},"z":0,"n":1,"k":"keys","set":"set","del":"delete"}');
let s = 0;
for (let i = 0; i < 3000; i++) {
  const o = { a: 0 };
  Object[unknown.k](o);
  const before = o.a | 0;
  o.a = i;
  o.b = 2;
  o.c = 3;
  o.d = 4;
  s = (s + before + (o.a | 0) + (o.d | 0)) % 1000003;
}
console.log(s | 0);
