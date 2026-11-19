// shift() of a long array with named properties moves no elements.
const makers = { integers: i => i, fractions: i => i + 0.5, strings: i => "s" + (i & 7), objects: i => ({ i }) };
const valueOf = v => (typeof v === "object" ? v.i : typeof v === "string" ? v.length : v);
function fill(length, make) {
  const list = [];
  for (let i = 0; i < length; i++) list.push(make(i));
  return list;
}
function drain(list) {
  let sum = 0;
  while (list.length) sum += valueOf(list.shift());
  return sum;
}
function turn(list, turns, make) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum += valueOf(list.shift());
    list.push(make(i));
  }
  return sum;
}
let text = "";
for (const [name, make] of Object.entries(makers)) {
  const tagged = fill(400_000, make);
  tagged.tag = name;
  tagged.other = { name };
  text += `${name} ${drain(tagged)} ${tagged.tag} ${tagged.other.name} ${tagged.length}\n`;
  const queue = fill(150_000, make);
  for (let i = 0; i < 9; i++) queue["name" + i] = i;
  text += `${turn(queue, 400_000, make)} ${queue.length} ${queue.name8} ${valueOf(queue[0])} ${valueOf(queue[149_999])} ${Object.keys(queue).length}\n`;
  delete queue.name3;
  queue.late = name;
  Bun.gc(true);
  text += `${turn(queue, 1_000, make)} ${queue.late} ${queue.name3} ${queue.name7} ${Object.keys(queue).slice(-9).join()}\n`;
}
console.log(text);
