// The receiver is written as a Map or a Set and nothing is proven of it: the functions are handed to unseen code. Each runs many times with what is written, and then with what is not.
import vm from "node:vm";
const unseen: any = (0, eval)("(x) => x");
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "string" ? part : JSON.stringify(part) ?? String(part)).join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \((evaluating|near|In) [\s\S]*$/, "")); } };
function pairs(members: Map<unknown, unknown>) { const seen: string[] = []; members.forEach((value, key, all) => { seen.push(String(Object.is(key, -0) ? "-0" : key) + "=" + String(value) + (all === members ? "" : "!")); }); return seen.join(); }
function ofSet(members: Set<unknown>) { const seen: string[] = []; members.forEach((value, again, all) => { seen.push(String(value) + (Object.is(value, again) ? "" : "?") + (all === members ? "" : "!")); }); return seen.join(); }
function counted(members: Map<string, number>) { let count = 0; members.forEach(() => { count++; }); return count; }
function withThis(members: Map<string, number>, receiver: { total: number }) { members.forEach(function (this: { total: number }, value) { this.total += value; }, receiver); return receiver.total; }
function sloppyThis(members: Set<number>) { const seen: string[] = []; members.forEach(function (this: unknown) { seen.push(typeof this); }); return seen.join(); }
function answer(members: Map<string, number>) { const given = members.forEach(value => value * 2); return String(given); }
function inTail(members: Map<string, number>, out: number[]) { return members.forEach(value => { out.push(value); }); }
function named(members: Map<string, number>) { let result: number[] | undefined; members.forEach((value, key) => { if (value > 1) (result ||= []).push(value); }); return result; }
function argumentsOfArrow(members: Set<number>) { const seen: number[] = []; members.forEach(function () { seen.push(arguments.length); }); return seen; }
const [p, s, c, t, l, a, i, n, g] = [pairs, ofSet, counted, withThis, sloppyThis, answer, inTail, named, argumentsOfArrow].map(unseen);
for (let turn = 0; turn < 200; turn++) { p(new Map([[turn, 1]])); s(new Set([turn])); c(new Map([["a", turn]])); n(new Map([["a", turn]])); }
const map = new Map<unknown, unknown>([["a", 1], [-0, NaN], [NaN, -0], [undefined, null], [null, undefined], [1n, {}], ["", ""]]);
say(p(map), "|", p(new Map()), "|", s(new Set([1, "x", -0, NaN, undefined, null])), "|", s(new Set()));
say(c(new Map([["a", 1], ["b", 2]])), t(new Map([["a", 1], ["b", 2]]), { total: 10 }), l(new Set([1, 2])), a(new Map([["a", 1]])), String(i(new Map([["a", 5]]), [])), n(new Map([["a", 1], ["b", 2], ["c", 3]])), String(n(new Map([["a", 1]]))), g(new Set([7])));
