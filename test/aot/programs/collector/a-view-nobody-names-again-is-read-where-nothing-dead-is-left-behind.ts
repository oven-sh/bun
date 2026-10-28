// A byte is read out of a view, a text is made, and then the byte is compared. Nothing names the view behind the read.
// The build puts a word that names nothing into every register and spilled word whose value is not read again, in front of each call that can run the collector.
function bytesOf(size: number, first: number): Uint8Array {
  const view = new Uint8Array(size);
  view[0] = first;
  return view;
}
let same = 0;
let other = 0;
const size = 40000;
for (let turn = 0; turn < 20000; turn++) {
  const view = bytesOf(size, 7);
  const first = view[0];
  const text = String(turn);
  if (first === 7) same += text.length;
  else other++;
}
console.log(same, other);
