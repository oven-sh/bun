// The rest element of an assignment pattern stores to its target wherever the pattern stands: behind a hole, in the head of a loop, on an element of a list, through a parameter, through a module namespace. A copy taken by a constant that is declared before the store keeps the old value.
import { shared } from "./shared";
import { storeThroughNamespace } from "./stores";
const behindHole = { rest: [1] };
const copyOfBehindHole = { ...behindHole };
const inLoopHead = { rest: [1] };
const copyOfInLoopHead = { ...inLoopHead };
const list = [[1], [2]];
const copyOfList = [...list];
const handed = { rest: [1] };
const copyOfHanded = { ...handed };
const copyOfShared = { ...shared };
const record: { rest: Record<string, number> } = { rest: { x: 1 } };
const copyOfRecord = { ...record };
function store(into: { rest: number[] }): void { [...into.rest] = [2, 3]; }
function read(): string { return JSON.stringify([copyOfBehindHole, copyOfInLoopHead, copyOfList, copyOfHanded, copyOfShared, copyOfRecord]); }
[, ...behindHole.rest] = [0, 2, 3];
for ([...inLoopHead.rest] of [[2, 3]]) {}
[...list[0]] = [9];
store(handed);
storeThroughNamespace();
({ ...record.rest } = { y: 2 });
console.log(read());
