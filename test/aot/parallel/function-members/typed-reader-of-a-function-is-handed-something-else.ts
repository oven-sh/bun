// The annotation names the function, and another object arrives.
function K() {}
K.n = 1;
function read(f: typeof K) {
  return f.n;
}
const other: any = { n: 50 };
console.log(read(K), read(other));
