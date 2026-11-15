// Under: --aot-check=Validate: the operator makes the joined text flat, and the verifier of inherited loads stopped on the word of its cell
const unseen = (x) => [x][JSON.parse("0")];
function probe(head, tail) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const text = head + tail;
  const before = text.length;
  const number = ~text;
  return before + work + (number === number ? 1 : 0) + text.charCodeAt(2);
}
let sum = 0;
for (let turn = 0; turn < 300; turn++) sum += probe(String(unseen("1234567890")), String(unseen("123456789")));
console.log(sum);
