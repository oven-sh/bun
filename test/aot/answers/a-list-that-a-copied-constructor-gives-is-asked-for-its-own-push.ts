// answers: without-library
// # The value that gather() names is a construction, and the record that it is bound to is a list: but the list was made by the copy of the constructor, which has put another object above it. What an operation of another frame has made is not what this body has made.
// # RUN(ASKED): walk f1 mechanisms=all
// # ASKED-LABEL: code f1:Body
// # ASKED: isLoopHead=true
// # ASKED: = PropGet {{*}}key="push"
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
const above = { push(this: unknown[], value: number) { this[this.length] = "above:" + value; return this.length; }, join: Array.prototype.join };
class Shelf { constructor(parent: object) { const list: unknown[] = []; Object.setPrototypeOf(list, parent); return list; } }
function gather(count: number, change: (k: number) => number): unknown[] { const result = new Shelf(above) as unknown as unknown[]; for (let k = 0; k < count; k++) result.push(change(k)); return result; }
const changes = [(k: number) => k * 2, (k: number) => k + 1];
for (let round = 0; round < 4; round++) report(gather(round + 1, changes[round % 2]).join());
report("end");
