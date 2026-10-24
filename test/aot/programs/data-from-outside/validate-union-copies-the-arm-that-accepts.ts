// validate<T>(value) copies by the arm of a union that accepts the value, the first in the order of the declaration: what that arm describes is copied, and what only another arm describes is shared with the argument, like any undeclared key.
import { validate } from "bun:bundle";
type Untagged = { a: number } | { b: { c: number } };
type Tagged = { k: "a"; p: unknown } | { k: "b"; p: { x: number } };
type Lists = unknown[] | { x: number }[];
type Shapes = { k: "a"; p: { x: number } } | { k: "b"; q: { x: number } };
const parse = (text: string): any => JSON.parse(text);

const untagged = parse('{"a":1,"b":{"c":2}}');
const first: any = validate<Untagged>(untagged);
console.log("a member of the arm that is not taken", first !== untagged, first.b !== untagged.b, JSON.stringify(first));

const tagged = parse('{"k":"a","p":{"x":1}}');
const second: any = validate<Tagged>(tagged);
console.log("a member that the tagged arm leaves unknown", second.p !== tagged.p, JSON.stringify(second));

const list = parse('[{"x":1}]');
const third: any = validate<Lists>(list);
console.log("an element", third !== list, third[0] !== list[0], JSON.stringify(third));

const own = parse('{"k":"a","p":{"x":1}}');
const fourth: any = validate<Shapes>(own);
console.log("only its own members", fourth.p !== own.p, Object.keys(fourth).join());

const both = parse('{"k":"a","p":{"x":1},"q":{"x":"text"}}');
const fifth: any = validate<Shapes>(both);
console.log("a member of the other tagged arm", fifth.p !== both.p, fifth.q !== both.q, JSON.stringify(fifth));

first.b.c = 3;
second.p.x = 4;
third[0].x = 5;
fifth.q.x = 6;
console.log("after stores into the copies", JSON.stringify([untagged, tagged, list, both]));
