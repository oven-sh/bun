// A long list of fractions grows behind a shift an unshift and a splice.
function digest(list) {
  let sum = 0;
  let holes = 0;
  for (let i = 0; i < list.length; i++) {
    const value = list[i];
    if (value === undefined) holes++;
    else sum = (sum + value * (i + 1)) % 1000003;
  }
  return list.length + " " + sum + " " + holes;
}
function fractions(size) {
  const list = [];
  for (let i = 0; i < size; i++) list.push((i & 255) + 0.5);
  return list;
}
const moves = {
  shift: list => list.shift(),
  unshift: list => list.unshift(0.25),
  splice: list => list.splice(0, 3),
};
const growths = {
  push: list => { for (let i = 0; i < 30000; i++) list.push(i + 0.25); },
  store: list => { for (let i = 0; i < 30000; i++) list[list.length] = i + 0.75; },
  length: list => { list.length += 5000; },
  concat: list => { list.push(...fractions(9000)); },
};
for (const move in moves) {
  for (const growth in growths) {
    const list = fractions(20000);
    moves[move](list);
    growths[growth](list);
    moves[move](list);
    growths[growth](list);
    console.log(move, growth, digest(list));
  }
}
