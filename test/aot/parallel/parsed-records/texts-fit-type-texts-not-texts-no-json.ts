// JSON.parse `as` a record: texts that fit the type in any order of keys, texts whose values do not fit, repeated keys, __proto__, extra keys, every kind of malformed text, primitives and arrays in place of the record, revivers.
type Inner = { x: number; y?: string };
type Rec = { id: number; name: string; ok: boolean; tags: string[]; inner: Inner; opt?: number; nul: null; list: Inner[] };
function show(v: unknown) { return Bun.inspect(v, { depth: 9, sorted: false }).replace(/\s+/g, " "); }
function tryParse(t: string) { try { const r = JSON.parse(t) as Rec; return show(r) + " | " + Object.keys(r as any).join(); } catch (e: any) { return e.constructor.name + ": " + e.message.split(" (evaluating")[0]; } }
const texts = [
  '{"id":1,"name":"a","ok":true,"tags":["x"],"inner":{"x":1},"nul":null,"list":[]}',
  '{"name":"a","id":1,"list":[{"x":1,"y":"q"},{"y":"r","x":2}],"ok":false,"tags":[],"inner":{"y":"s","x":-0},"nul":null}',
  '{"id":"not a number","name":5,"ok":null,"tags":{"0":"x"},"inner":[1],"nul":1,"list":"no"}',
  '{"id":1,"id":2,"name":"a","name":"b"}', '{"__proto__":{"evil":1},"id":1}', '{"id":1,"extra":{"deep":[1,{"a":null}]},"constructor":1,"toString":2}',
  '{"id":1e400,"name":"\\u0041\\ud83d\\ude00\\n","ok":true}', '{"id":-0,"opt":0.1e1,"inner":{"x":1E+2}}', '{"id":01}', '{"id":1,}', '{"id":+1}', "{'id':1}", '{"id":1}x', ' \n\t{"id" : 1 } \r', '{"id":.5}', '{"id":1.}', '{"id":-}', '{"name":"\t"}', '{"name":"\\x41"}', '{"name":"\\u12"}', '{"name":"unterminated', '', 'null', '[]', '1', '"s"', 'true', '[1,2,,3]', '{"10":1,"2":2,"a":3,"1":4}', '{"":1," ":2}', '﻿{"id":1}', '{"id":123456789012345678901234567890}', '{"id":9007199254740993}', '{"tags":["a","b",3,null,["n"]]}', '{"list":[{"x":1},null,5,{"x":"s"}]}', '{"inner":null}', '{"inner":{"x":1,"x":{"y":2}}}',
];
for (const t of texts) console.log(tryParse(t));
const r = JSON.parse(texts[0]) as Rec; console.log(r.id + 1, r.name.length, r.tags.length, r.inner.x * 2, r.opt === undefined, r.list.length, Object.getPrototypeOf(r) === Object.prototype, Array.isArray(r.tags));
const bad = JSON.parse(texts[2]) as Rec; console.log(typeof bad.id, typeof bad.name, bad.ok, typeof bad.tags, Array.isArray(bad.inner), bad.nul, typeof bad.list);
console.log(show(JSON.parse('{"a":1,"b":[1,2,{"c":3}]}', function (k, v) { return typeof v === "number" ? v * 2 : v; })), show(JSON.parse('{"a":1,"b":2}', (k, v) => (k === "a" ? undefined : v))));
function sum(n: number) { let t = 0; for (let i = 0; i < n; i++) { const o = JSON.parse('{"id":' + i + ',"name":"n","ok":true,"tags":["a","b"],"inner":{"x":' + i / 2 + '},"nul":null,"list":[{"x":1}]}') as Rec; t += o.id + o.inner.x + o.tags.length + o.list[0].x; } return t; } console.log(sum(300));
