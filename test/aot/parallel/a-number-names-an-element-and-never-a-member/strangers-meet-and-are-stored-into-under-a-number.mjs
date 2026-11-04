class A { x = 1; }
class B { y = 1; 0 = 5; }
const both = [new A, new B];
function put(h, i, v) { h[i] = v; }
for (const h of both) put(h, [].length, "text");
console.log(typeof both[0][0], typeof both[1][0], typeof both[0].x, typeof both[1].y, Object.keys(both[0]).join(), Object.keys(both[1]).join());
