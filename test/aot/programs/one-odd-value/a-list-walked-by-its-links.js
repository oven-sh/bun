// One link of a list of a hundred thousand is an object out of JSON.parse. The link is what goes around the loop, so the links behind the odd one are fast only if the slow path comes back into the loop.
class N { constructor(v, next) { this.v = v; this.next = next; } }
function walk(head) {
  let total = 0;
  for (let n = head; n; n = n.next) total = (total + n.v) | 0;
  return total;
}
let head = null;
for (let i = 0; i < 100000; i++) {
  if (i === 99990) { const odd = JSON.parse('{"next":null,"v":5,"x":1}'); odd.next = head; head = odd; } else head = new N(i, head);
}
let r = 0;
for (let k = 0; k < 200; k++) r = (r + walk(head)) | 0;
console.log(r);
