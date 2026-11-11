export const shared = [0, 0, 0];
const late = [0, 0];
let moved = [0, 0, 0];
function outer(k) { const own = [0, 0]; const inner = i => { let s = 0; for (const x of own) s += own[i % 2] + x; return s; }; own[k & 1] = k; return inner(k); }
function walk(k) { let s = 0; for (const x of shared) s += shared[k % 3] + x; for (let i = 0; i < shared.length; i++) s += shared[i]; for (const x of late) s += late[k % 2]; for (const x of moved) s += moved[k % 3]; return s; }
class Keep { static zeros = [0, 0]; list = [0, 0, 0]; sum(k) { let s = 0; for (const x of Keep.zeros) s += Keep.zeros[k % 2] + x; for (const x of this.list) s += this.list[k % 3]; return s; } }
function lazily() { const table = [0, 0]; return k => { let s = 0; for (const x of table) s += table[k % 2]; return s; }; }
const take = lazily();
console.log(outer(3), walk(4), new Keep().sum(5), take(1), take(2));
moved[1] = 5; moved = [0, 0]; late.push(7);
console.log(walk(7), shared.indexOf(0), late.join(), moved.join());
