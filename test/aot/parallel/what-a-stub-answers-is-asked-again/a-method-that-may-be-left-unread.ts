// Flags: --aot-testing=CheckWalkAtRunTime
// Where arguments stand between the read of a method and its call, and the receiver is proven to be of a built-in class and is as its class made it, the method is left unread and the call runs the built-in's own body. Under the word that checks the walk that decision is asked again of the receiver at the call; a receiver with a method of its own is read, and that read is asked again.
// Thirty pushes onto the plain list are asked at the call, thirty reads off the list with a push of its own behind the read. Where the call no longer looks whether the receiver is as made, the first push onto the second list stops by name.
// In a loop that can begin its turn again in its closed copy the receiver is tested in the turn itself and the push stands in line: no stub answers there, so nothing is asked again for the plain list. The same pushes are made without a loop too, where they go by the stub: thirty asked at the call, thirty behind the read.
// COUNTER: FastPathResultsVerified >= 90
let calls = 0;
function next(i: number): number { calls++; for (let k = 0; k < 2; k++) calls = (calls + k) | 0; return i * 2; }
function fill(list: number[], n: number): number { let last = 0; for (let i = 0; i < n; i++) last = list.push(next(i)); return last; }
function fillWithoutLoop(list: number[], i: number, n: number): number { if (i >= n) return 0; const last = list.push(next(i)); return fillWithoutLoop(list, i + 1, n) || last; }
function look(table: Map<string, number>, keys: string[]): string { let text = ""; for (let i = 0; i < keys.length; i++) text += table.get(pick(keys, i)) + ","; return text; }
function pick(keys: string[], i: number): string { calls++; for (let k = 0; k < 2; k++) calls = (calls + k) | 0; return keys[i]; }
const plain: number[] = [], own: number[] = [];
(own as any).push = function (v: number) { return Array.prototype.push.call(this, v + 1) + 100; };
const plainToo: number[] = [], ownToo: number[] = [];
(ownToo as any).push = own.push;
const table = new Map([["a", 1]]), other = new Map([["a", 2]]);
(other as any).get = function (key: string) { return "own " + Map.prototype.get.call(this, key); };
console.log(fill(plain, 30), fill(own, 30), plain.join("-").length, own.join("-").length);
console.log(fillWithoutLoop(plainToo, 0, 30), fillWithoutLoop(ownToo, 0, 30), plainToo.join("-").length, ownToo.join("-").length);
console.log(look(table, ["a", "b"]), look(other, ["a", "b"]), calls);
