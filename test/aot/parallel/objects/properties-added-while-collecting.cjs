// Twigs of a tree gain properties after their construction, while collections of the kept trees run beside.
function Spot(place, row) {
  this.row = row;
  this.place = place;
}

function Twig(from) {
  this.spot = new Spot(from & 15, from >> 4);
  this.till = 0;
  this.from = from;
  this.sort = "";
}
globalThis.Twig = Twig;

const factories = { create: (from) => new globalThis.Twig(from) };
const close = (twig, sort, till) => {
  twig.till = till;
  twig.sort = sort;
  return twig;
};

function createLeaf(from) {
  const twig = factories.create(from);
  if (from & 1) {
    twig.label = "n" + (from & 7);
    twig.loose = undefined;
    return close(twig, "leaf", from + 1);
  }
  twig.weight = from / 2;
  twig.text = String(from);
  twig.more = { bent: from % 3 === 0 };
  return close(twig, "bud", from + 2);
}

function createTree(from, depth) {
  if (depth === 0) return createLeaf(from);
  const twig = factories.create(from);
  twig.low = createTree(from + 1, depth - 1);
  twig.joint = depth & 1 ? "+" : "*";
  twig.high = createTree(from + 2, depth - 1);
  if (depth % 4 === 0) {
    for (let i = 0; i < 9; i++) twig["mark" + i] = [from, i];
  }
  return close(twig, "fork", from + depth);
}

function sum(twig) {
  switch (twig.sort) {
    case "leaf":
      return twig.label.length + (twig.loose === undefined && "loose" in twig ? 1 : 0);
    case "bud":
      return twig.weight + twig.text.length + (twig.more.bent ? 1 : 0);
    default: {
      let marks = 0;
      for (let i = 0; i < 9; i++) marks += twig["mark" + i]?.[1] ?? 0;
      return sum(twig.low) + sum(twig.high) + marks + twig.joint.length;
    }
  }
}

const kept = [];
let total = 0;
for (let i = 0; i < 160; i++) {
  kept[i % 40] = createTree(i, 10);
  const old = kept[(i * 7) % 40];
  if (old) old["seen" + (i % 5)] = createLeaf(i);
  total += sum(kept[(i * 3) % 40] ?? kept[0]);
}
console.log(total);
console.log(Object.keys(kept[3]).join());
console.log(JSON.stringify(createTree(5, 2)));
