// One base constructor that is called, not copied, makes the objects of two classes below it in turn: behind the first of each the run time is not asked again, but where an allocator has run dry or a collection has passed.
// COUNT: operation:operationAOTSetConstructPrototype <= 4000
"use strict";
class Base { constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.size = n + 1 + work; } }
class First extends Base { constructor(n) { super(n); this.mark = n + 2; } }
class Second extends Base { constructor(n) { super(n); this.mark = n + 3; this.more = n; } }
function fill(count) { const rows = []; for (let i = 0; i < count; i++) rows.push(i & 1 ? new First(i) : new Second(i)); return rows; }
function total(rows) { let sum = 0; for (let i = 0; i < rows.length; i++) sum += rows[i].mark + rows[i].size; return sum; }
const rows = fill(200000);
console.log(total(rows), Object.keys(rows[0]).join(), Object.keys(rows[1]).join(), rows[0] instanceof Second, rows[1] instanceof First);
