// Flags: --aot-check=verify-each-pass
function Holder(o) { this.keep = o; }
let sum = 0;
for (let i = 0; i < 500; i++) sum += [{ i }].map(o => new Holder(o))[0].keep.i;
console.log(sum);
