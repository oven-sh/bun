const tag: unique symbol = Symbol("tag");
const other = Symbol("other");
interface Row {
a: number;
b?: string;
c?: number;
d?: boolean;
[tag]?: number;
}
class Item implements Row {
a: number;
b?: string;
constructor(a: number) {
this.a = a;
}
}
class Wide implements Row {
a: number;
c: number = 1;
d: boolean = false;
constructor(a: number) {
this.a = a;
}
}
const parent = { inherited: 1 };
const untyped = (value: unknown): any => value;
const keys: (string | symbol)[] = ["a", "b", "c", "d", "z", "late", tag, other];
const makers: ((v: number) => Row)[] = [
(v: number): Row => new Item(v),
(v: number): Row => untyped({ a: v, z: 1 }),
(v: number): Row => Object.assign(Object.create(parent), { a: v }),
(v: number): Row => ({ d: true, a: v }),
(v: number): Row => ({ a: v, b: "b" + v }),
];
let state = 315776534;
function next(limit: number): number {
state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
return (state >>> 8) % limit;
}
const make = (v: number): Row => makers[v % makers.length](v);
const held: Row[] = [];
for (let index = 0; index < 4; index++) held.push(make(index));
let writes = 0;
let failures = 0;
let sum = 7;
function mix(text: string): void {
for (let at = 0; at < text.length; at++) sum = (Math.imul(sum, 31) + text.charCodeAt(at)) | 0;
}
function describe(row: Row): string {
const parts: string[] = [];
const all = Object.getOwnPropertyDescriptors(row) as Record<string | symbol, PropertyDescriptor>;
for (const key of Reflect.ownKeys(row)) {
const own = all[key];
parts.push(String(key) + "=" + ("value" in own ? String(own.value) : "accessor " + String(own.get?.())) + (own.enumerable ? "e" : "-") + (own.configurable ? "c" : "-") + (own.writable ? "w" : "-"));
}
const walked: string[] = [];
for (const key in row) walked.push(key);
return parts.join() + "|" + Object.keys(row).join() + "|" + walked.join() + "|" + JSON.stringify(row) + "|" + (Object.isFrozen(row) ? "f" : "") + (Object.isSealed(row) ? "s" : "") + (Object.isExtensible(row) ? "x" : "");
}
function step(which: number, at: number, t: Row, s: Row, u: Row, k: string | symbol, v: number): void {
const put = (row: Row): void => {
held[at] = row;
};
switch (which) {
case 0: {
delete t[tag];
break;
}
case 1: {
Object.defineProperties(t, Object.getOwnPropertyDescriptors(s));
break;
}
case 2: {
t.b = "s" + v;
break;
}
case 3: {
Object.assign(t, s, u, { c: v });
break;
}
case 4: {
put(untyped(Object.defineProperties({}, Object.getOwnPropertyDescriptors(s))));
break;
}
case 5: {
if (v % 61 === 0) Object.freeze(t);
break;
}
case 6: {
put(make(v));
break;
}
case 7: {
delete t.c;
break;
}
case 8: {
put(Object.assign(new Item(v), s));
break;
}
case 9: {
t.a = v;
break;
}
case 10: {
put({ ...s, ...u });
break;
}
case 11: {
Reflect.deleteProperty(t, k);
break;
}
case 12: {
t.c = v;
break;
}
case 13: {
put(make(v));
break;
}
case 14: {
put(make(v));
break;
}
case 15: {
Object.assign(t, { a: v });
break;
}
case 16: {
put(Object.create(Object.getPrototypeOf(s), Object.getOwnPropertyDescriptors(s)));
break;
}
case 17: {
if (v % 53 === 0) Object.setPrototypeOf(t, parent);
break;
}
case 18: {
Object.assign(t, null, undefined, s);
break;
}
case 19: {
Object.defineProperty(t, k, { enumerable: false });
break;
}
}
}
for (let round = 1; round <= 6000; round++) {
const at = next(held.length);
try {
step(next(20), at, held[at], held[next(held.length)], held[next(held.length)], keys[next(keys.length)], next(1000));
} catch {
failures++;
}
if (!Object.isExtensible(held[at]) && round % 5 === 0) held[at] = make(round);
mix(describe(held[at]));
if (round % 750 === 0) console.log("round", round, sum, failures, writes);
}
for (const row of held) console.log(describe(row));

export {};
// long-object-histories-with-attributes 1496992201
