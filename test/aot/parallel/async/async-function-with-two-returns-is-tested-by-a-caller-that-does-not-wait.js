// an async function that never waits returns false on one way and true on the other, and its caller tests the promise itself
async function isLeaf(n) { if (n.kids) return false; return true; }
function subject(n) { if (isLeaf(n)) return "promise"; return "nothing"; }
function deed(n) { return subject(n) + ":" + typeof isLeaf(n); }
console.log(deed({}), deed({ kids: 1 }), deed({ kids: 0 }));
let promises = 0;
for (let i = 0; i < 300; i++) promises += subject({ kids: i % 2 }) === "promise" ? 1 : 0;
console.log(String(promises));
console.log(deed(JSON.parse('{"kids":[]}')));
