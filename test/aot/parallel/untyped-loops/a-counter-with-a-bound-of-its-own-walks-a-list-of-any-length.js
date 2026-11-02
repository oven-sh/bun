// `for (let i = from; i < bound; i += step) .. shapes[i] ..`: the loop ends at `bound`, and `shapes[i]` asks about the length of the list.
// One test at the end of a turn may answer for both. Here the list is shorter than the bound, as long, longer, empty, and changes its length on the way.
function sizes(shapes, from, bound, step) {
  let sum = 0;
  let missing = 0;
  for (let i = from; i < bound; i += step) {
    const shape = shapes[i];
    if (shape === undefined) missing++;
    else if (shape.kind === "circle") sum += shape.radius + shape.radius;
    else if (shape.kind === "square") sum += shape.side;
    else sum += shape.grow(shapes);
  }
  return sum + " " + missing;
}
function sizesOfFiveHundred(shapes) {
  let sum = 0;
  let missing = 0;
  for (let i = 0; i < 500; i++) {
    const shape = shapes[i];
    if (shape === undefined) missing++;
    else if (shape.kind === "circle") sum += shape.radius + shape.radius;
    else if (shape.kind === "square") sum += shape.side;
    else sum += shape.grow(shapes);
  }
  return sum + " " + missing;
}
function list(length) {
  let text = "[";
  for (let i = 0; i < length; i++) text += (i ? "," : "") + (i % 3 ? `{"kind":"circle","radius":${i}}` : `{"kind":"square","side":${i + 0.25}}`);
  return JSON.parse(text + "]");
}
for (let turn = 0; turn < 40; turn++) {
  sizes(list(500), 0, 500, 1);
  sizesOfFiveHundred(list(500));
}
for (const length of [0, 1, 2, 499, 500, 501, 1000]) {
  console.log(length, sizesOfFiveHundred(list(length)));
  for (const [from, bound, step] of [
    [0, 500, 1],
    [0, 0, 1],
    [0, 1, 1],
    [499, 500, 1],
    [500, 500, 1],
    [501, 500, 1],
    [3, 1001, 2],
    [0, 499.5, 1],
    [0.5, 10, 1],
    [-3, 5, 1],
    [0, 2147483648 + 3, 1073741824],
    [4294967290, 4294967300, 1],
  ])
    console.log(length, from, bound, step, sizes(list(length), from, bound, step));
}
for (const change of [shapes => shapes.push(...list(300)), shapes => (shapes.length = 120), shapes => (shapes.length = 0), shapes => shapes.splice(110, 50), shapes => shapes.unshift(...list(7))]) {
  for (const run of [shapes => sizes(shapes, 0, 500, 1), sizesOfFiveHundred]) {
    const shapes = list(300);
    let calls = 0;
    shapes[100] = {
      kind: "other",
      grow(all) {
        calls++;
        change(all);
        return 0.5;
      },
    };
    console.log(run(shapes), calls, shapes.length);
  }
}
