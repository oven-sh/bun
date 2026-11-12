// The same with eight classes below: none pushes another out of what the run time remembers.
// COUNT: operation:operationAOTSetConstructPrototype <= 4000
"use strict";
class Node { constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.pos = n + work; this.end = n + 1; } }
class Kind0 extends Node { constructor(n) { super(n); this.kind = 0; this.f0 = n; } }
class Kind1 extends Node { constructor(n) { super(n); this.kind = 1; this.f1 = n; } }
class Kind2 extends Node { constructor(n) { super(n); this.kind = 2; this.f2 = n; } }
class Kind3 extends Node { constructor(n) { super(n); this.kind = 3; this.f3 = n; } }
class Kind4 extends Node { constructor(n) { super(n); this.kind = 4; this.f4 = n; } }
class Kind5 extends Node { constructor(n) { super(n); this.kind = 5; this.f5 = n; } }
class Kind6 extends Node { constructor(n) { super(n); this.kind = 6; this.f6 = n; } }
class Kind7 extends Node { constructor(n) { super(n); this.kind = 7; this.f7 = n; } }
const kinds = [Kind0, Kind1, Kind2, Kind3, Kind4, Kind5, Kind6, Kind7];
function make(i) { switch (i & 7) { case 0: return new Kind0(i); case 1: return new Kind1(i); case 2: return new Kind2(i); case 3: return new Kind3(i); case 4: return new Kind4(i); case 5: return new Kind5(i); case 6: return new Kind6(i); case 7: return new Kind7(i); } }
function fill(count) { const rows = []; for (let i = 0; i < count; i++) rows.push(make(i)); return rows; }
function total(rows) { let sum = 0; for (let i = 0; i < rows.length; i++) sum += rows[i].pos + rows[i].end + rows[i].kind; return sum; }
const rows = fill(200000);
console.log(total(rows), Object.keys(rows[3]).join(), rows[3] instanceof kinds[3], rows[3] instanceof kinds[4]);
