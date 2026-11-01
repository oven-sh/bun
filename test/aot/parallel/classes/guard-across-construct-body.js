// Flags: --aot-check=verify-each-pass
// `new Holder(o)` in the callback of map() becomes a call of a body that the pass has just made. It does what Holder does, so the test of the list that map() fills holds behind it.
function viaCallback(i) {
  function Holder(o) { this.keep = o; }
  return [{ i }].map(o => new Holder(o))[0];
}
let sum = 0;
for (let i = 0; i < 500; i++) sum += viaCallback(i).keep.i;
console.log(sum);
