// answers: without-library
// # Optional fields are stored on some objects, read, asked for, filled late, deleted and set to undefined, and walked along a chain.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 39 of 39 of 39
// # CHECK-NEXT: exited with 0
interface Item { id: number; note?: string; count?: number; next?: Item }
function make(id: number): Item { const item: Item = { id }; if (id % 2) item.note = "n" + id; if (id % 3 === 0) item.count = id; return item; }
function read(item: Item): string { return item.id + ":" + item.note + ":" + item.count + ":" + (item.next ? item.next.id : "-"); }
function has(item: Item): string { return ("note" in item) + ":" + (item.count !== undefined) + ":" + Object.keys(item).join(); }
function fill(item: Item): string { item.count = (item.count ?? 0) + 1; item.note ??= "late"; return read(item); }
function empty(item: Item): string { delete item.note; item.count = undefined; return read(item) + ":" + has(item); }
function chain(length: number): number { let first: Item | undefined; for (let id = 0; id < length; id++) { const item = make(id); item.next = first; first = item; } let sum = 0; for (let item = first; item; item = item.next) sum += item.id + (item.count ?? 10) + (item.note ? item.note.length : 0); return sum; }
for (let id = 0; id < 7; id++) { const item = make(id); report(read(item)); report(has(item)); report(fill(item)); report(has(item)); report(empty(item)); }
report(chain(0)); report(chain(1)); report(chain(9));
report("end");
