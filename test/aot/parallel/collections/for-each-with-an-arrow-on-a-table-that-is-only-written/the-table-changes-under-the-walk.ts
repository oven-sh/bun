// The receiver is written as a Map or a Set and nothing is proven of it: the functions are handed to unseen code. Each runs many times with what is written, and then with what is not.
import vm from "node:vm";
const unseen: any = (0, eval)("(x) => x");
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "string" ? part : JSON.stringify(part) ?? String(part)).join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \((evaluating|near|In) [\s\S]*$/, "")); } };
function grows(members: Map<number, number>) { const seen: number[] = []; members.forEach((value, key) => { seen.push(key); if (key < 5) members.set(key + 1, value); }); return seen; }
function shrinks(members: Map<number, number>) { const seen: number[] = []; members.forEach((value, key) => { seen.push(key); members.delete(key + 1); }); return seen; }
function deletesItself(members: Set<number>) { const seen: number[] = []; members.forEach(value => { seen.push(value); members.delete(value); }); return [seen, members.size]; }
function comesAgain(members: Set<number>) { const seen: number[] = []; members.forEach(value => { seen.push(value); if (seen.length < 6) { members.delete(value); members.add(value); } }); return seen; }
function cleared(members: Map<number, number>) { const seen: number[] = []; members.forEach((value, key) => { seen.push(key); if (key === 2) { members.clear(); members.set(9, 9); } }); return seen; }
function overwrites(members: Map<number, number>) { const seen: number[] = []; members.forEach((value, key) => { seen.push(value); members.set(3, 30); }); return seen; }
function growsFar(members: Set<number>) { let count = 0; members.forEach(value => { count++; if (value < 3000) members.add(value + 1); }); return count; }
function nested(members: Map<number, number>) { const seen: string[] = []; members.forEach((a, x) => { members.forEach((b, y) => { seen.push(x + "" + y); if (x === 1 && y === 1) members.set(3, 3); }); }); return seen.join(); }
const all = [grows, shrinks, deletesItself, comesAgain, cleared, overwrites, growsFar, nested].map(unseen);
for (let turn = 0; turn < 3; turn++) say(all[0](new Map([[1, 1]])), all[1](new Map([[1, 1], [2, 2], [3, 3], [4, 4]])), all[2](new Set([1, 2, 3])), all[3](new Set([1, 2])), all[4](new Map([[1, 1], [2, 2], [3, 3]])), all[5](new Map([[1, 1], [2, 2], [3, 3]])), all[6](new Set([1])), all[7](new Map([[1, 1], [2, 2]])));
