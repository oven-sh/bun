class A { get x() { return "above"; } }
function fill(a) { a.x = "own"; return a; }
console.log(fill(new A()).x);
