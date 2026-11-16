// The arms of `x = c ? a : b` do nothing but hand on a value, and the only reader of it stands above them in the loop: it is found needed when the branch has long been looked at. The branch stays.
function turns(n: number, a: number, b: number) { let x = 0, sum = 0; for (let i = 0; i < n; i++) { sum += x; x = i & 1 ? a : b; } return sum; }
function twoDeep(n: number, a: number, b: number) { let x = 0, y = 0, sum = 0; for (let i = 0; i < n; i++) { sum += y; y = x; x = i % 3 ? a : b; } return sum; }
function texts(n: number) { let x = "", all = ""; for (let i = 0; i < n; i++) { all += x; x = i & 1 ? "o" : "e"; } return all; }
function sameOnBothWays(n: number, a: number) { let x = 0, sum = 0; for (let i = 0; i < n; i++) { sum += x; x = i & 1 ? a : a; } return sum; }
function behindTheLoop(n: number, a: number, b: number) { let x = 0; for (let i = 0; i < n; i++) x = i & 1 ? a : b; return x; }
console.log(turns(9, 10, 1), twoDeep(11, 10, 1), texts(7), sameOnBothWays(5, 3), behindTheLoop(4, 7, 8), behindTheLoop(5, 7, 8), behindTheLoop(0, 7, 8));
