// V1, by its reader (REVIEW.txt:3 c): the base constructor returns an older object, and the derived constructor stores into it between two reads of the caller
class Box { constructor(s) { this.size = s; } }
const kept = new Box(1);
class Trick { constructor() { return kept; } }
class Sub extends Trick { constructor() { super(); this.size = 9; } }
function read(b) { const before = b.size; new Sub(); return before * 100 + b.size; }
console.log(String(read(kept)));
function again(b, n) { let t = 0; for (let i = 0; i < n; i++) { const before = b.size; new Sub(); t += before * 100 + b.size; } return t; }
console.log(String(again(new Box(1), 3)), String(again(kept, 3)));
