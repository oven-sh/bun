// A loop that is left early closes its iterator: what stands for one over a text has no `return`, and a second loop begins at the head again.
const request = new Request("http://localhost/");
const text = JSON.parse('"stop here"');
let count = 0;
for (const piece of text) {
  if (piece === " ") break;
  count++;
}
console.log(count);
try {
  for (const piece of text) {
    if (piece === "o") throw new RangeError("thrown at " + piece);
  }
} catch (error) {
  console.log(error.message);
}
let all = 0;
for (const piece of text) all += piece.length;
console.log(all, request.method);
