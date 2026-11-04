class A { 0() { return "method"; } }
const a = new A;
function put(o, i, v) { o[i] = v; }
put(a, [].length, () => "own");
console.log(a[0](), new A()[0]());
