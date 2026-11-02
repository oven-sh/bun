// map() hands its callback the element, the index and the list. Bound to a target, Object.assign copies from all three: the target gets the properties of the element, and under "0" the element itself.
function throughMap(round) {
  const target = { a: 1 };
  const lines = [];
  for (let i = 0; i < 3; i++) {
    const element = { a: "changed" + i, n: i };
    const list = [element];
    list.map(Object.assign.bind(null, target));
    element.n = i + 10;
    lines.push([target.a, target.n, target[0] === element, target[0].n, target[0].a, Object.keys(target).join("|")].join());
    target[0].late = round;
    lines.push([element.late, list[0].late].join());
  }
  return lines.join(" ; ");
}
for (let round = 0; round < 3; round++) console.log(throughMap(round));

function writtenOut(round) {
  const target = { 0: null, a: 1 };
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const element = { n: i };
    Object.assign(target, element, [element]);
    target[0].n = round + 100;
    seen.push(element.n, target.n);
  }
  return seen.join();
}
for (let round = 0; round < 3; round++) console.log(writtenOut(round));

function intoAnArray() {
  const seen = [];
  const target = [0, 0];
  for (let i = 0; i < 3; i++) {
    const element = [i];
    Object.assign(target, [element], { 1: element });
    target[0][0] = 7 + i;
    seen.push(element[0], target[1][0], target[0] === target[1]);
  }
  return seen.join();
}
console.log(intoAnArray());

const kept = { a: 1 };
for (let i = 0; i < 3; i++) [{ a: "changed" }].map(Object.assign.bind(null, kept));
console.log(JSON.stringify(kept));
