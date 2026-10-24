// JSON.parse<T>(text) returns, in every way a program can observe, what JSON.parse(text) returns. T only adds the throw.
interface Address { street: string; city: string; zip?: string }
interface User {
  id: number;
  name: string;
  nickname?: string;
  tags: string[];
  address: Address;
  boss?: User | null;
  options?: Record<string, any>;
  anything?: unknown;
  thing?: object;
}
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };
interface Drawing { shapes: Shape[]; size: [number, number]; names: Record<string, number> }

function show(value: any, depth = 0): string {
  if (Array.isArray(value)) return "[" + value.map(item => show(item, depth + 1)).join(",") + "]";
  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : typeof value + ":" + String(value);
  const parts: string[] = [];
  for (const key in value) parts.push(key);
  const own = Object.getOwnPropertyNames(value);
  const described = own.map(key => {
    const found = Object.getOwnPropertyDescriptor(value, key)!;
    return JSON.stringify(key) + (found.writable && found.enumerable && found.configurable ? "" : "!") + "=" + show(found.value, depth + 1);
  });
  return "{" + described.join(",") + "|" + parts.join() + "|" + Object.keys(value).join() + "|" + (Object.getPrototypeOf(value) === Object.prototype) + "}";
}

const address = '{"street":"s","city":"c"}';
const users = [
  `{"id":1,"name":"a","tags":[],"address":${address}}`,
  `{"id":1,"name":"a","nickname":"n","tags":["x","y"],"address":${address}}`,
  `{"id":1,"name":"a","tags":[],"address":{"street":"s","city":"c","zip":"z"},"boss":null}`,
  `{"address":${address},"tags":[],"name":"a","id":1}`,
  `{"name":"a","extra":1,"id":2,"tags":[],"address":${address},"more":{"x":[1,{"y":2}]}}`,
  `{"zeta":0,"tags":[],"name":"b","id":2,"address":{"city":"c","q":[],"street":"s"},"boss":{"tags":[],"q":1,"id":3,"name":"c","address":${address}}}`,
  `{"id":1,"id":2,"name":"a","name":"b","tags":[],"address":${address}}`,
  `{"id":"no","id":2,"name":"a","tags":[],"address":${address}}`,
  `{"id":1,"name":"a","tags":[],"address":${address},"__proto__":{"x":1}}`,
  `{"__proto__":null,"id":1,"name":"a","tags":[],"address":${address}}`,
  `{"id":1,"name":"a","tags":[],"address":${address},"1":"one","0":"zero","-1":"minus"}`,
  `{"id":-0,"name":"","tags":[""],"address":${address}}`,
  `{"id":1e21,"name":"a","tags":[],"address":${address}}`,
  `{"id":0.1,"name":"\\u0061\\n\\ud83d\\ude00","tags":["\\""],"address":${address}}`,
  `{"id":1,"name":"a","tags":[],"address":${address},"options":{"b":1,"a":{"c":[]},"__proto__":5,"2":2,"1":1}}`,
  `{"id":1,"name":"a","tags":[],"address":${address},"anything":{"z":1,"a":[{"b":null}]},"thing":[1,2]}`,
  `{"id":1,"name":"a","tags":[],"address":${address},"constructor":1,"toString":2,"valueOf":null,"hasOwnProperty":false}`,
  ` {\n  "id" : 1 ,\t"name":"a",\r\n"tags" : [ ] , "address" : { "street" : "s" , "city" : "c" } } `,
  `{"\\u0069d":1,"name":"a","tags":[],"address":${address}}`,
  `{"id":1,"name":"ā","tags":["Ā"],"address":${address},"ключ":"значение"}`,
  `{"id":1,"name":"a","tags":[],"address":${address},"":"empty"}`,
  `{"id":1,"name":"a","nickname":"n","nickname":"m","tags":[],"address":${address}}`,
];
for (const text of users) {
  const typed = JSON.parse<User>(text);
  console.log(show(typed) === show(JSON.parse(text)), JSON.stringify(typed) === JSON.stringify(JSON.parse(text)), show(typed));
  console.log(typed.id, typed.name, typed.nickname, typed.tags.length, typed.address.city, typed.address.zip, typed.boss?.name);
}
const drawings = [
  '{"shapes":[],"size":[1,2],"names":{}}',
  '{"shapes":[{"kind":"circle","radius":1},{"kind":"square","side":2}],"size":[1,2],"names":{"b":1,"a":2}}',
  '{"shapes":[{"radius":1,"kind":"circle"},{"side":2,"color":"red","kind":"square"}],"size":[1.5,-0],"names":{"__proto__":1,"1":1}}',
  '{"names":{"a":1,"a":2},"size":[0,0],"shapes":[{"kind":"circle","radius":1,"side":"also"}]}',
];
for (const text of drawings) {
  const typed = JSON.parse<Drawing>(text);
  console.log(show(typed) === show(JSON.parse(text)), show(typed));
  let sum = 0;
  for (const shape of typed.shapes) sum += shape.kind === "circle" ? shape.radius : shape.side;
  console.log(sum, typed.size[0] + typed.size[1]);
}
for (const text of ["1", "-0", "1.5e3", '"text"', "true", "null", "[1,2]", '["a"]', "[]", ' [ 1 , 2 ] ']) {
  const results: string[] = [];
  try { results.push(show(JSON.parse<number>(text))); } catch { results.push("-"); }
  try { results.push(show(JSON.parse<string>(text))); } catch { results.push("-"); }
  try { results.push(show(JSON.parse<boolean | null>(text))); } catch { results.push("-"); }
  try { results.push(show(JSON.parse<number[]>(text))); } catch { results.push("-"); }
  console.log(text, show(JSON.parse(text)), results.filter(result => result !== "-").every(result => result === show(JSON.parse(text))));
}
const kept = JSON.parse<User>(users[4]) as User & { extra: number; more: { x: unknown[] } };
kept.id += 1;
kept.extra += 1;
(kept as any).later = true;
delete (kept as any).more;
console.log(show(kept), JSON.stringify(kept));
console.log(JSON.stringify(JSON.parse<User>(users[5]), null, 1));
console.log(JSON.stringify({ ...JSON.parse<User>(users[4]) }), JSON.stringify(Object.entries(JSON.parse<User>(users[3]))));
