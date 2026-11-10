// STATISTIC: WalkLoopsVersioned >= 0
'use strict';
const q = Number(process.argv[2] ?? 3);
function make(first) { return class { #rows = [first, 2.5, q]; get rows() { return this.#rows; } static sum(o, t) { let s = t & 1; for (let i = 0; i < o.#rows.length; i++) s = s + o.#rows[i] * 2; return s; } }; }
const A = make(1.5), B = make(100.5), a = new A(), b = new B();
function tried(C, o, t) { try { return C.sum(o, t); } catch (e) { return e instanceof TypeError ? 'TypeError' : 'other'; } }
const said = []; for (let t = 0; t < 30; t++) { tried(A, a, t); tried(B, b, t); }
said.push(tried(A, a, 0), tried(B, b, 0), tried(A, b, 0), tried(B, a, 0), a.rows[0] + b.rows[0]); console.log(said.join());
