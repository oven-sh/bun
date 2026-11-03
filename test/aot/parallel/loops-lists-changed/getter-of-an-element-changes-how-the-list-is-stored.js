// A loop reads `shapes[i]` and fields of it. How the list stores its elements, where, and how many, is asked in front of the loop.
// In the middle of the loop the getter of one element changes that: the turns behind it have to see the list as it is then.
function sizes(shapes, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const shape = shapes[i];
    if (shape === undefined) sum += 1000000;
    else if (shape.kind === "circle") sum += shape.radius + shape.radius;
    else sum += shape.side;
  }
  return sum;
}
function sizesOfAThousand(shapes) {
  let sum = 0;
  for (let i = 0; i < 1000; i++) {
    const shape = shapes[i];
    if (shape === undefined) sum += 1000000;
    else if (shape.kind === "circle") sum += shape.radius + shape.radius;
    else sum += shape.side;
  }
  return sum;
}
function list() {
  let text = "[";
  for (let i = 0; i < 1000; i++) text += (i ? "," : "") + (i % 3 ? `{"kind":"circle","radius":${i}}` : `{"kind":"square","side":${i + 0.25}}`);
  return JSON.parse(text + "]");
}
const changes = {
  nothing(shapes) {},
  shorter(shapes) {
    shapes.length = 600;
  },
  "shorter and longer again"(shapes) {
    shapes.length = 600;
    shapes.length = 1000;
  },
  "far element"(shapes) {
    shapes[5000000] = { kind: "square", side: 1 };
  },
  "accessor as an element"(shapes) {
    Object.defineProperty(shapes, 700, { get: () => ({ kind: "square", side: 7000 }) });
  },
  "grown past its room"(shapes) {
    for (let i = 0; i < 5000; i++) shapes.push({ kind: "square", side: 0 });
    for (let i = 501; i < 1000; i++) shapes[i] = { kind: "square", side: 2 };
  },
  "first elements taken away"(shapes) {
    for (let i = 0; i < 100; i++) shapes.shift();
  },
  "element deleted"(shapes) {
    delete shapes[800];
  },
  frozen(shapes) {
    Object.freeze(shapes);
  },
};
for (const run of [shapes => sizes(shapes, 1000), sizesOfAThousand]) {
  for (let turn = 0; turn < 50; turn++) run(list());
  for (const name in changes) {
    const shapes = list();
    let calls = 0;
    Object.defineProperty(shapes[500], "kind", {
      get() {
        if (!calls++) changes[name](shapes);
        return "circle";
      },
    });
    console.log(name, run(shapes), calls, run(shapes), shapes.length);
  }
}
