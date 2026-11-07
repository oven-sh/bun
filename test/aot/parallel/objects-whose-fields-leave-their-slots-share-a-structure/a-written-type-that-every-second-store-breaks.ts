// COUNTER: CompiledStructuresMade <= 8
// COUNTER: operationAOTGetByIdAndCache <= 8
// The field is written `string`, and every second object is stored a number through `any`. No object leaves the program.
class Holder { text: string; constructor(value: any) { this.text = value; } }
function run(count: number) { let total = 0; for (let i = 0; i < count; i++) { const holder = new Holder((i & 1) === 0 ? i : "t"); total += String(holder.text).length; } return total; }
console.log(run(2000));
