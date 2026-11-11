class Frame {
  constructor(wide, high) { this.wide = wide; this.high = high; }
}
function extent(frame) { return +frame.wide - frame.high; }
const parse = (text) => JSON.parse(text);
const kept = [];
function run(box) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const size = extent(box);
  const read = () => size * 2;
  if (size & 32) work = (work + 1) | 0;
  kept.push(read);
  return work;
}
const first = extent(new Frame(7, 2));
const box = parse("true") ? new Frame(40, 4) : parse('{"wide":1,"high":2}');
console.log(first, run(box), kept[0]());
