// The steps of the spread stay in compiled code: the operation of the run time, which steps from native code, is not entered.
// COUNTER: operationAOTAppendIterable = 0
function* upTo(limit: number): Generator<number> { for (let i = 0; i < limit; i++) yield i; }
const count = (...values: number[]) => values.length + ":" + values.join();
class Kept { values: number[]; constructor(...values: number[]) { this.values = values; } }
console.log([...upTo(5)].join(), count(...upTo(3)), new Kept(...upTo(4)).values.join(), ["head", ...upTo(2), "middle", ...upTo(0), ...upTo(1), "tail"].join());
let total = 0;
for (let turn = 0; turn < 20000; turn++) total += [...upTo(turn % 7)].length;
console.log(total);
