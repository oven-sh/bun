const outside = (0, eval)("(holder, value) => { holder.mark = value; try { Object.defineProperty(holder, 'mark', { value }); return 'defined'; } catch (error) { return error.constructor.name; } }");
const fixed = {}; Object.defineProperty(fixed, "mark", { value: 1, enumerable: true });
const loose = {}; Object.defineProperty(loose, "mark", { value: 1, enumerable: true, configurable: true });
function read(holder) { let sum = 0; for (let i = 0; i < 30; i++) sum += holder.mark; return sum; }
let said = "";
for (let turn = 0; turn < 300; turn++) { read(fixed); read(loose); if (turn === 150) said += outside(fixed, 7) + " " + outside(loose, 7) + " "; }
console.log(said, read(fixed), read(loose), Object.getOwnPropertyDescriptor(loose, "mark").writable);
