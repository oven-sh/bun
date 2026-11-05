interface Circle {
  kind: "circle";
  radius: number;
}

interface Rectangle {
  kind: "rectangle";
  width: number;
  height: number;
}

type Figure = Circle | Rectangle;

function sizeOf(figure: Figure): number {
  switch (figure.kind) {
    case "circle":
      return figure.radius * 3;
    case "rectangle":
      return figure.width * figure.height;
  }
}

function aUnionToldApartByATag(): () => number {
  const figures: Figure[] = [];
  for (let i = 0; i < 50; i++) figures.push({ kind: "circle", radius: i }, { kind: "rectangle", width: i, height: 2 });
  return function turnOfAUnionToldApartByATag() {
    let total = 0;
    for (let i = 0; i < 100; i++) total += sizeOf(figures[i]);
    return total;
  };
}

enum Level {
  Low,
  Middle,
  High,
}

const costs = [1, 10, 100];

function costOf(level: Level): number {
  return costs[level];
}

function aNumericEnumAsAKey(): () => number {
  const levels: Level[] = [];
  for (let i = 0; i < 100; i++) levels.push(i % 3 === 0 ? Level.Low : i % 3 === 1 ? Level.Middle : Level.High);
  return function turnOfANumericEnumAsAKey() {
    let total = 0;
    for (let i = 0; i < 100; i++) total += costOf(levels[i]);
    return total;
  };
}

enum Kind {
  Leaf,
  Pair,
}

interface Leaf {
  kind: Kind.Leaf;
  value: number;
}

interface Pair {
  kind: Kind.Pair;
  left: Tree;
  right: Tree;
}

type Tree = Leaf | Pair;

class TreeObject {
  kind: Kind;
  constructor(kind: Kind) {
    this.kind = kind;
  }
}

function makeLeaf(value: number): Leaf {
  const made = new TreeObject(Kind.Leaf) as unknown as Leaf;
  made.value = value;
  return made;
}

function makePair(left: Tree, right: Tree): Pair {
  const made = new TreeObject(Kind.Pair) as unknown as Pair;
  made.left = left;
  made.right = right;
  return made;
}

function totalOf(tree: Tree): number {
  return tree.kind === Kind.Leaf ? tree.value : totalOf(tree.left) + totalOf(tree.right);
}

function aConstructorThatStoresTheTag(): () => number {
  let tree: Tree = makeLeaf(0);
  for (let i = 1; i < 50; i++) tree = makePair(tree, makeLeaf(i));
  return function turnOfAConstructorThatStoresTheTag() {
    return totalOf(tree);
  };
}

export const cases = {
  "11 nodes of one class whose constructor stores the tag": aConstructorThatStoresTheTag,
  "11 a union told apart by a tag": aUnionToldApartByATag,
  "13 a numeric enum as a key": aNumericEnumAsAKey,
};
