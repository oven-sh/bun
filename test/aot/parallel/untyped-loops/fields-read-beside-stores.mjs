// fields read by some iterations off unknown objects, beside stores into objects that may be the same
class Row { constructor(k) { this.k = k; this.m = 2; } get twice() { return this.k * 2; } }
const box = { k: 1, m: 2 }, spare = { k: 50, m: 3 }, row = new Row(3), tree = { part: box, k: 7, m: 1 }, cells = [1, 2, 3, 4], bytes = new Uint8Array(4);
let total = 0, calls = 0;
function part(c, reads) { if (reads) return c.k * 2; return 1; }
function arm_literal(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.k; else { box.k = i; } } return s; }
function arm_literalAdd(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.k; else { box.k += i; } } return s; }
function arm_literalStep(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.k; else { box.k++; } } return s; }
function arm_other(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.k; else { box.m = i; } } return s; }
function arm_classField(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.k; else { row.k = i; } } return s; }
function arm_deep(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.k; else { tree.part.k = i; } } return s; }
function arm_list(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.k; else { cells[i & 3] = i; } } return s; }
function arm_variable(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.k; else { total += i; } } return s; }
function arm_replace(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.k; else { tree.part = i & 4 ? box : spare; } } return s; }
function arm_typed(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.k; else { bytes[i & 3] = i; } } return s; }
function arm_none(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.k; else {  } } return s; }
function armFirst_literal(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i % 3 === 1) s += c.k; box.k = i; } return s; }
function armFirst_literalAdd(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i % 3 === 1) s += c.k; box.k += i; } return s; }
function armFirst_literalStep(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i % 3 === 1) s += c.k; box.k++; } return s; }
function armFirst_other(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i % 3 === 1) s += c.k; box.m = i; } return s; }
function armFirst_classField(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i % 3 === 1) s += c.k; row.k = i; } return s; }
function armFirst_deep(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i % 3 === 1) s += c.k; tree.part.k = i; } return s; }
function armFirst_list(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i % 3 === 1) s += c.k; cells[i & 3] = i; } return s; }
function armFirst_variable(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i % 3 === 1) s += c.k; total += i; } return s; }
function armFirst_replace(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i % 3 === 1) s += c.k; tree.part = i & 4 ? box : spare; } return s; }
function armFirst_typed(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i % 3 === 1) s += c.k; bytes[i & 3] = i; } return s; }
function armFirst_none(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i % 3 === 1) s += c.k;  } return s; }
function armLast_literal(c, y) { let s = 0; for (let i = 0; i < 12; i++) { box.k = i; if (i > 4) s += c.k; } return s; }
function armLast_literalAdd(c, y) { let s = 0; for (let i = 0; i < 12; i++) { box.k += i; if (i > 4) s += c.k; } return s; }
function armLast_literalStep(c, y) { let s = 0; for (let i = 0; i < 12; i++) { box.k++; if (i > 4) s += c.k; } return s; }
function armLast_other(c, y) { let s = 0; for (let i = 0; i < 12; i++) { box.m = i; if (i > 4) s += c.k; } return s; }
function armLast_classField(c, y) { let s = 0; for (let i = 0; i < 12; i++) { row.k = i; if (i > 4) s += c.k; } return s; }
function armLast_deep(c, y) { let s = 0; for (let i = 0; i < 12; i++) { tree.part.k = i; if (i > 4) s += c.k; } return s; }
function armLast_list(c, y) { let s = 0; for (let i = 0; i < 12; i++) { cells[i & 3] = i; if (i > 4) s += c.k; } return s; }
function armLast_variable(c, y) { let s = 0; for (let i = 0; i < 12; i++) { total += i; if (i > 4) s += c.k; } return s; }
function armLast_replace(c, y) { let s = 0; for (let i = 0; i < 12; i++) { tree.part = i & 4 ? box : spare; if (i > 4) s += c.k; } return s; }
function armLast_typed(c, y) { let s = 0; for (let i = 0; i < 12; i++) { bytes[i & 3] = i; if (i > 4) s += c.k; } return s; }
function armLast_none(c, y) { let s = 0; for (let i = 0; i < 12; i++) {  if (i > 4) s += c.k; } return s; }
function conditional_literal(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += i & 1 ? c.k * 2 : 1; if (i & 2) { box.k = i; } } return s; }
function conditional_literalAdd(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += i & 1 ? c.k * 2 : 1; if (i & 2) { box.k += i; } } return s; }
function conditional_literalStep(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += i & 1 ? c.k * 2 : 1; if (i & 2) { box.k++; } } return s; }
function conditional_other(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += i & 1 ? c.k * 2 : 1; if (i & 2) { box.m = i; } } return s; }
function conditional_classField(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += i & 1 ? c.k * 2 : 1; if (i & 2) { row.k = i; } } return s; }
function conditional_deep(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += i & 1 ? c.k * 2 : 1; if (i & 2) { tree.part.k = i; } } return s; }
function conditional_list(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += i & 1 ? c.k * 2 : 1; if (i & 2) { cells[i & 3] = i; } } return s; }
function conditional_variable(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += i & 1 ? c.k * 2 : 1; if (i & 2) { total += i; } } return s; }
function conditional_replace(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += i & 1 ? c.k * 2 : 1; if (i & 2) { tree.part = i & 4 ? box : spare; } } return s; }
function conditional_typed(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += i & 1 ? c.k * 2 : 1; if (i & 2) { bytes[i & 3] = i; } } return s; }
function conditional_none(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += i & 1 ? c.k * 2 : 1; if (i & 2) {  } } return s; }
function stored_literal(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) y[i] = c.k; if (i === 4) { box.k = i; } } return s; }
function stored_literalAdd(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) y[i] = c.k; if (i === 4) { box.k += i; } } return s; }
function stored_literalStep(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) y[i] = c.k; if (i === 4) { box.k++; } } return s; }
function stored_other(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) y[i] = c.k; if (i === 4) { box.m = i; } } return s; }
function stored_classField(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) y[i] = c.k; if (i === 4) { row.k = i; } } return s; }
function stored_deep(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) y[i] = c.k; if (i === 4) { tree.part.k = i; } } return s; }
function stored_list(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) y[i] = c.k; if (i === 4) { cells[i & 3] = i; } } return s; }
function stored_variable(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) y[i] = c.k; if (i === 4) { total += i; } } return s; }
function stored_replace(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) y[i] = c.k; if (i === 4) { tree.part = i & 4 ? box : spare; } } return s; }
function stored_typed(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) y[i] = c.k; if (i === 4) { bytes[i & 3] = i; } } return s; }
function stored_none(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) y[i] = c.k; if (i === 4) {  } } return s; }
function clamped_literal(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { y[i] = y[i] < c.k ? c.k : y[i] > 6 ? c.m : y[i]; if (i > 2) { box.k = i; } } return s; }
function clamped_literalAdd(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { y[i] = y[i] < c.k ? c.k : y[i] > 6 ? c.m : y[i]; if (i > 2) { box.k += i; } } return s; }
function clamped_literalStep(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { y[i] = y[i] < c.k ? c.k : y[i] > 6 ? c.m : y[i]; if (i > 2) { box.k++; } } return s; }
function clamped_other(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { y[i] = y[i] < c.k ? c.k : y[i] > 6 ? c.m : y[i]; if (i > 2) { box.m = i; } } return s; }
function clamped_classField(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { y[i] = y[i] < c.k ? c.k : y[i] > 6 ? c.m : y[i]; if (i > 2) { row.k = i; } } return s; }
function clamped_deep(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { y[i] = y[i] < c.k ? c.k : y[i] > 6 ? c.m : y[i]; if (i > 2) { tree.part.k = i; } } return s; }
function clamped_list(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { y[i] = y[i] < c.k ? c.k : y[i] > 6 ? c.m : y[i]; if (i > 2) { cells[i & 3] = i; } } return s; }
function clamped_variable(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { y[i] = y[i] < c.k ? c.k : y[i] > 6 ? c.m : y[i]; if (i > 2) { total += i; } } return s; }
function clamped_replace(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { y[i] = y[i] < c.k ? c.k : y[i] > 6 ? c.m : y[i]; if (i > 2) { tree.part = i & 4 ? box : spare; } } return s; }
function clamped_typed(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { y[i] = y[i] < c.k ? c.k : y[i] > 6 ? c.m : y[i]; if (i > 2) { bytes[i & 3] = i; } } return s; }
function clamped_none(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { y[i] = y[i] < c.k ? c.k : y[i] > 6 ? c.m : y[i]; if (i > 2) {  } } return s; }
function never_literal(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i > 99) s += c.k; box.k = i; } return s; }
function never_literalAdd(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i > 99) s += c.k; box.k += i; } return s; }
function never_literalStep(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i > 99) s += c.k; box.k++; } return s; }
function never_other(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i > 99) s += c.k; box.m = i; } return s; }
function never_classField(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i > 99) s += c.k; row.k = i; } return s; }
function never_deep(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i > 99) s += c.k; tree.part.k = i; } return s; }
function never_list(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i > 99) s += c.k; cells[i & 3] = i; } return s; }
function never_variable(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i > 99) s += c.k; total += i; } return s; }
function never_replace(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i > 99) s += c.k; tree.part = i & 4 ? box : spare; } return s; }
function never_typed(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i > 99) s += c.k; bytes[i & 3] = i; } return s; }
function never_none(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i > 99) s += c.k;  } return s; }
function once_literal(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i === 7) s += c.k; if (i > 8) s += c.k; box.k = i; } return s; }
function once_literalAdd(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i === 7) s += c.k; if (i > 8) s += c.k; box.k += i; } return s; }
function once_literalStep(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i === 7) s += c.k; if (i > 8) s += c.k; box.k++; } return s; }
function once_other(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i === 7) s += c.k; if (i > 8) s += c.k; box.m = i; } return s; }
function once_classField(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i === 7) s += c.k; if (i > 8) s += c.k; row.k = i; } return s; }
function once_deep(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i === 7) s += c.k; if (i > 8) s += c.k; tree.part.k = i; } return s; }
function once_list(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i === 7) s += c.k; if (i > 8) s += c.k; cells[i & 3] = i; } return s; }
function once_variable(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i === 7) s += c.k; if (i > 8) s += c.k; total += i; } return s; }
function once_replace(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i === 7) s += c.k; if (i > 8) s += c.k; tree.part = i & 4 ? box : spare; } return s; }
function once_typed(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i === 7) s += c.k; if (i > 8) s += c.k; bytes[i & 3] = i; } return s; }
function once_none(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i === 7) s += c.k; if (i > 8) s += c.k;  } return s; }
function inner_literal(c, y) { let s = 0; for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) { if (i & 1) s += c.k; if (j) { box.k = i; } } return s; }
function inner_literalAdd(c, y) { let s = 0; for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) { if (i & 1) s += c.k; if (j) { box.k += i; } } return s; }
function inner_literalStep(c, y) { let s = 0; for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) { if (i & 1) s += c.k; if (j) { box.k++; } } return s; }
function inner_other(c, y) { let s = 0; for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) { if (i & 1) s += c.k; if (j) { box.m = i; } } return s; }
function inner_classField(c, y) { let s = 0; for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) { if (i & 1) s += c.k; if (j) { row.k = i; } } return s; }
function inner_deep(c, y) { let s = 0; for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) { if (i & 1) s += c.k; if (j) { tree.part.k = i; } } return s; }
function inner_list(c, y) { let s = 0; for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) { if (i & 1) s += c.k; if (j) { cells[i & 3] = i; } } return s; }
function inner_variable(c, y) { let s = 0; for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) { if (i & 1) s += c.k; if (j) { total += i; } } return s; }
function inner_replace(c, y) { let s = 0; for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) { if (i & 1) s += c.k; if (j) { tree.part = i & 4 ? box : spare; } } return s; }
function inner_typed(c, y) { let s = 0; for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) { if (i & 1) s += c.k; if (j) { bytes[i & 3] = i; } } return s; }
function inner_none(c, y) { let s = 0; for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) { if (i & 1) s += c.k; if (j) {  } } return s; }
function outer_literal(c, y) { let s = 0; for (let j = 0; j < 4; j++) { let i = j; if (j & 1) for (let n = 0; n < 3; n++) if (n) s += c.k; box.k = i; } return s; }
function outer_literalAdd(c, y) { let s = 0; for (let j = 0; j < 4; j++) { let i = j; if (j & 1) for (let n = 0; n < 3; n++) if (n) s += c.k; box.k += i; } return s; }
function outer_literalStep(c, y) { let s = 0; for (let j = 0; j < 4; j++) { let i = j; if (j & 1) for (let n = 0; n < 3; n++) if (n) s += c.k; box.k++; } return s; }
function outer_other(c, y) { let s = 0; for (let j = 0; j < 4; j++) { let i = j; if (j & 1) for (let n = 0; n < 3; n++) if (n) s += c.k; box.m = i; } return s; }
function outer_classField(c, y) { let s = 0; for (let j = 0; j < 4; j++) { let i = j; if (j & 1) for (let n = 0; n < 3; n++) if (n) s += c.k; row.k = i; } return s; }
function outer_deep(c, y) { let s = 0; for (let j = 0; j < 4; j++) { let i = j; if (j & 1) for (let n = 0; n < 3; n++) if (n) s += c.k; tree.part.k = i; } return s; }
function outer_list(c, y) { let s = 0; for (let j = 0; j < 4; j++) { let i = j; if (j & 1) for (let n = 0; n < 3; n++) if (n) s += c.k; cells[i & 3] = i; } return s; }
function outer_variable(c, y) { let s = 0; for (let j = 0; j < 4; j++) { let i = j; if (j & 1) for (let n = 0; n < 3; n++) if (n) s += c.k; total += i; } return s; }
function outer_replace(c, y) { let s = 0; for (let j = 0; j < 4; j++) { let i = j; if (j & 1) for (let n = 0; n < 3; n++) if (n) s += c.k; tree.part = i & 4 ? box : spare; } return s; }
function outer_typed(c, y) { let s = 0; for (let j = 0; j < 4; j++) { let i = j; if (j & 1) for (let n = 0; n < 3; n++) if (n) s += c.k; bytes[i & 3] = i; } return s; }
function outer_none(c, y) { let s = 0; for (let j = 0; j < 4; j++) { let i = j; if (j & 1) for (let n = 0; n < 3; n++) if (n) s += c.k;  } return s; }
function whiled_literal(c, y) { let s = 0; let i = 0; while (i < 12) { if (i & 1) s += c.k; else { box.k = i; } i++; } return s; }
function whiled_literalAdd(c, y) { let s = 0; let i = 0; while (i < 12) { if (i & 1) s += c.k; else { box.k += i; } i++; } return s; }
function whiled_literalStep(c, y) { let s = 0; let i = 0; while (i < 12) { if (i & 1) s += c.k; else { box.k++; } i++; } return s; }
function whiled_other(c, y) { let s = 0; let i = 0; while (i < 12) { if (i & 1) s += c.k; else { box.m = i; } i++; } return s; }
function whiled_classField(c, y) { let s = 0; let i = 0; while (i < 12) { if (i & 1) s += c.k; else { row.k = i; } i++; } return s; }
function whiled_deep(c, y) { let s = 0; let i = 0; while (i < 12) { if (i & 1) s += c.k; else { tree.part.k = i; } i++; } return s; }
function whiled_list(c, y) { let s = 0; let i = 0; while (i < 12) { if (i & 1) s += c.k; else { cells[i & 3] = i; } i++; } return s; }
function whiled_variable(c, y) { let s = 0; let i = 0; while (i < 12) { if (i & 1) s += c.k; else { total += i; } i++; } return s; }
function whiled_replace(c, y) { let s = 0; let i = 0; while (i < 12) { if (i & 1) s += c.k; else { tree.part = i & 4 ? box : spare; } i++; } return s; }
function whiled_typed(c, y) { let s = 0; let i = 0; while (i < 12) { if (i & 1) s += c.k; else { bytes[i & 3] = i; } i++; } return s; }
function whiled_none(c, y) { let s = 0; let i = 0; while (i < 12) { if (i & 1) s += c.k; else {  } i++; } return s; }
function of_literal(c, y) { let s = 0; let i = 0; for (const v of y) { if (v > 2) s += c.k; else { box.k = i; } i++; } return s; }
function of_literalAdd(c, y) { let s = 0; let i = 0; for (const v of y) { if (v > 2) s += c.k; else { box.k += i; } i++; } return s; }
function of_literalStep(c, y) { let s = 0; let i = 0; for (const v of y) { if (v > 2) s += c.k; else { box.k++; } i++; } return s; }
function of_other(c, y) { let s = 0; let i = 0; for (const v of y) { if (v > 2) s += c.k; else { box.m = i; } i++; } return s; }
function of_classField(c, y) { let s = 0; let i = 0; for (const v of y) { if (v > 2) s += c.k; else { row.k = i; } i++; } return s; }
function of_deep(c, y) { let s = 0; let i = 0; for (const v of y) { if (v > 2) s += c.k; else { tree.part.k = i; } i++; } return s; }
function of_list(c, y) { let s = 0; let i = 0; for (const v of y) { if (v > 2) s += c.k; else { cells[i & 3] = i; } i++; } return s; }
function of_variable(c, y) { let s = 0; let i = 0; for (const v of y) { if (v > 2) s += c.k; else { total += i; } i++; } return s; }
function of_replace(c, y) { let s = 0; let i = 0; for (const v of y) { if (v > 2) s += c.k; else { tree.part = i & 4 ? box : spare; } i++; } return s; }
function of_typed(c, y) { let s = 0; let i = 0; for (const v of y) { if (v > 2) s += c.k; else { bytes[i & 3] = i; } i++; } return s; }
function of_none(c, y) { let s = 0; let i = 0; for (const v of y) { if (v > 2) s += c.k; else {  } i++; } return s; }
function copied_literal(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += part(c, i & 1); box.k = i; } return s; }
function copied_literalAdd(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += part(c, i & 1); box.k += i; } return s; }
function copied_literalStep(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += part(c, i & 1); box.k++; } return s; }
function copied_other(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += part(c, i & 1); box.m = i; } return s; }
function copied_classField(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += part(c, i & 1); row.k = i; } return s; }
function copied_deep(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += part(c, i & 1); tree.part.k = i; } return s; }
function copied_list(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += part(c, i & 1); cells[i & 3] = i; } return s; }
function copied_variable(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += part(c, i & 1); total += i; } return s; }
function copied_replace(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += part(c, i & 1); tree.part = i & 4 ? box : spare; } return s; }
function copied_typed(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += part(c, i & 1); bytes[i & 3] = i; } return s; }
function copied_none(c, y) { let s = 0; for (let i = 0; i < 12; i++) { s += part(c, i & 1);  } return s; }
function chain_literal(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.part ? c.part.k : c.k; else { box.k = i; } } return s; }
function chain_literalAdd(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.part ? c.part.k : c.k; else { box.k += i; } } return s; }
function chain_literalStep(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.part ? c.part.k : c.k; else { box.k++; } } return s; }
function chain_other(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.part ? c.part.k : c.k; else { box.m = i; } } return s; }
function chain_classField(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.part ? c.part.k : c.k; else { row.k = i; } } return s; }
function chain_deep(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.part ? c.part.k : c.k; else { tree.part.k = i; } } return s; }
function chain_list(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.part ? c.part.k : c.k; else { cells[i & 3] = i; } } return s; }
function chain_variable(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.part ? c.part.k : c.k; else { total += i; } } return s; }
function chain_replace(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.part ? c.part.k : c.k; else { tree.part = i & 4 ? box : spare; } } return s; }
function chain_typed(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.part ? c.part.k : c.k; else { bytes[i & 3] = i; } } return s; }
function chain_none(c, y) { let s = 0; for (let i = 0; i < 12; i++) { if (i & 1) s += c.part ? c.part.k : c.k; else {  } } return s; }
function compare_literal(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) if (y[i] > c.k) s++; box.k = i; } return s; }
function compare_literalAdd(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) if (y[i] > c.k) s++; box.k += i; } return s; }
function compare_literalStep(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) if (y[i] > c.k) s++; box.k++; } return s; }
function compare_other(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) if (y[i] > c.k) s++; box.m = i; } return s; }
function compare_classField(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) if (y[i] > c.k) s++; row.k = i; } return s; }
function compare_deep(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) if (y[i] > c.k) s++; tree.part.k = i; } return s; }
function compare_list(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) if (y[i] > c.k) s++; cells[i & 3] = i; } return s; }
function compare_variable(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) if (y[i] > c.k) s++; total += i; } return s; }
function compare_replace(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) if (y[i] > c.k) s++; tree.part = i & 4 ? box : spare; } return s; }
function compare_typed(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) if (y[i] > c.k) s++; bytes[i & 3] = i; } return s; }
function compare_none(c, y) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) if (y[i] > c.k) s++;  } return s; }
const bodies = { arm_literal, arm_literalAdd, arm_literalStep, arm_other, arm_classField, arm_deep, arm_list, arm_variable, arm_replace, arm_typed, arm_none, armFirst_literal, armFirst_literalAdd, armFirst_literalStep, armFirst_other, armFirst_classField, armFirst_deep, armFirst_list, armFirst_variable, armFirst_replace, armFirst_typed, armFirst_none, armLast_literal, armLast_literalAdd, armLast_literalStep, armLast_other, armLast_classField, armLast_deep, armLast_list, armLast_variable, armLast_replace, armLast_typed, armLast_none, conditional_literal, conditional_literalAdd, conditional_literalStep, conditional_other, conditional_classField, conditional_deep, conditional_list, conditional_variable, conditional_replace, conditional_typed, conditional_none, stored_literal, stored_literalAdd, stored_literalStep, stored_other, stored_classField, stored_deep, stored_list, stored_variable, stored_replace, stored_typed, stored_none, clamped_literal, clamped_literalAdd, clamped_literalStep, clamped_other, clamped_classField, clamped_deep, clamped_list, clamped_variable, clamped_replace, clamped_typed, clamped_none, never_literal, never_literalAdd, never_literalStep, never_other, never_classField, never_deep, never_list, never_variable, never_replace, never_typed, never_none, once_literal, once_literalAdd, once_literalStep, once_other, once_classField, once_deep, once_list, once_variable, once_replace, once_typed, once_none, inner_literal, inner_literalAdd, inner_literalStep, inner_other, inner_classField, inner_deep, inner_list, inner_variable, inner_replace, inner_typed, inner_none, outer_literal, outer_literalAdd, outer_literalStep, outer_other, outer_classField, outer_deep, outer_list, outer_variable, outer_replace, outer_typed, outer_none, whiled_literal, whiled_literalAdd, whiled_literalStep, whiled_other, whiled_classField, whiled_deep, whiled_list, whiled_variable, whiled_replace, whiled_typed, whiled_none, of_literal, of_literalAdd, of_literalStep, of_other, of_classField, of_deep, of_list, of_variable, of_replace, of_typed, of_none, copied_literal, copied_literalAdd, copied_literalStep, copied_other, copied_classField, copied_deep, copied_list, copied_variable, copied_replace, copied_typed, copied_none, chain_literal, chain_literalAdd, chain_literalStep, chain_other, chain_classField, chain_deep, chain_list, chain_variable, chain_replace, chain_typed, chain_none, compare_literal, compare_literalAdd, compare_literalStep, compare_other, compare_classField, compare_deep, compare_list, compare_variable, compare_replace, compare_typed, compare_none };
const holders = { box: () => box, row: () => row, tree: () => tree, spare: () => spare, part: () => tree.part, parsed: () => JSON.parse('{"k":2.5,"m":4}'), whole: () => JSON.parse('{"k":3,"m":4}'), text: () => JSON.parse('{"k":"s"}'), none: () => ({}), nul: () => null, undef: () => undefined, list: () => Object.assign([1], { k: 5, m: 1 }), inherits: () => Object.create(box), inheritsRow: () => Object.create(row), getter: () => ({ get k() { return ++calls; }, m: 1 }), proxy: () => new Proxy(box, { get(t, key) { calls++; return t[key]; } }), frozen: () => Object.freeze({ k: 1.5, m: 1 }), bytes: () => bytes, cells: () => cells, func: () => Object.assign(function f() {}, { k: 2 }) };
const show = v => typeof v === "object" && v !== null ? "o" : typeof v + String(v);
let runs = 0;
for (const b in bodies) { let hash = 0; for (const h in holders) for (let round = 0; round < 2; round++) {
  box.k = 1; box.m = 2; row.k = 3; row.m = 2; tree.part = box; tree.k = 7; total = 0; cells.length = 4; cells.fill(1);
  const y = round ? [1.5, 2.5, 3, 4.5, 5, 6.5, 7, 8] : [1, 2, 3, 4, 5, 6, 7, 8];
  let line = h; runs++;
  try { line += show(bodies[b](holders[h](), y)); } catch (e) { line += e.name; }
  line += y.map(show).join() + [box.k, box.m, row.k, tree.part === box, total, cells.join(), bytes.join(), calls].join("|");
  if (process.argv.includes("all")) console.log(b, line);
  for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
} console.log(b, hash); }
console.log(runs, calls);
