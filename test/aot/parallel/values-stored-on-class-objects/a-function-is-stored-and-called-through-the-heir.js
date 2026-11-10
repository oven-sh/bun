// A function is stored and called through the heir.
class Tree { static run() { return this.step(); } } class Ash extends Tree {}
const all = [Tree, Ash]; all[0].step = () => 0;
let sum = 0; for (let i = 0; i < 400; i++) { all[0].step = i & 1 ? () => 1 : () => 10; sum += all[1].run() + Ash.step(); } console.log(sum);
