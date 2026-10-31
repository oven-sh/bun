// `JSON.parse(text)` into a type that holds itself: lists of one to six objects, trees and two types that hold each other, with and without members that the type does not declare, each text parsed several times.
interface Item {
  id: number;
  name: string;
  next: Item | null;
}
interface Tree {
  value: number;
  left: Tree | null;
  right: Tree | null;
}
interface Owner {
  title: string;
  pet: Pet | null;
}
interface Pet {
  kind: string;
  owner: Owner | null;
}
const parsers = {
  item: (text: string): Item => JSON.parse(text),
  items: (text: string): Item[] => JSON.parse(text),
  tree: (text: string): Tree => JSON.parse(text),
  trees: (text: string): Tree[] => JSON.parse(text),
  owner: (text: string): Owner => JSON.parse(text),
  pets: (text: string): Pet[] => JSON.parse(text),
};
function keysOf(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(keysOf).join(" ") + "]";
  if (value === null || typeof value !== "object") return "";
  return (
    "(" +
    Object.entries(value)
      .map(([key, member]) => key + keysOf(member))
      .join(",") +
    ")"
  );
}
function sumOfItems(item: Item | null): string {
  let sum = "";
  for (; item; item = item.next) sum += item.id + item.name;
  return sum;
}
function sumOfTree(tree: Tree | null): number {
  return tree ? tree.value + 2 * sumOfTree(tree.left) + 3 * sumOfTree(tree.right) : 1;
}
function sumOfOwner(owner: Owner | null): string {
  return owner ? owner.title + (owner.pet ? owner.pet.kind + sumOfOwner(owner.pet.owner) : "-") : ".";
}
function show(label: string, how: keyof typeof parsers, text: string, times = 3) {
  for (let turn = 0; turn < times; turn++) {
    let shown: string;
    try {
      const value = parsers[how](text);
      shown = JSON.stringify(value) + " " + keysOf(value) + " ";
      if (how === "item") shown += sumOfItems(value as Item);
      else if (how === "items") shown += (value as Item[]).map(sumOfItems).join();
      else if (how === "tree") shown += sumOfTree(value as Tree);
      else if (how === "trees") shown += (value as Tree[]).map(sumOfTree).join();
      else if (how === "owner") shown += sumOfOwner(value as Owner);
      else shown += (value as Pet[]).map(pet => pet.kind + sumOfOwner(pet.owner)).join();
    } catch (error) {
      shown = "throws " + error;
    }
    console.log(label + ", turn " + turn + ":", shown);
  }
}
function list(levels: number, membersAt: (level: number) => string): string {
  let text = "null";
  for (let level = levels - 1; level >= 0; level--) text = "{" + membersAt(level).replace("NEXT", text) + "}";
  return text;
}
function tree(levels: number, membersAt: (level: number) => string, level = 0): string {
  if (level >= levels) return "null";
  return (
    "{" +
    membersAt(level)
      .replace("LEFT", tree(levels, membersAt, level + 1))
      .replace("RIGHT", tree(levels - 1, membersAt, level + 1)) +
    "}"
  );
}
const formsOfItems: [string, (level: number) => string][] = [
  ["as declared", level => `"id":${level},"name":"n${level}","next":NEXT`],
  ["one more in each", level => `"id":${level},"x":${level},"name":"n${level}","next":NEXT`],
  ["one more in the outermost", level => `"id":${level},"name":"n${level}",${level ? "" : '"x":0,'}"next":NEXT`],
  ["one more in the innermost two", level => `"id":${level},"name":"n${level}","next":NEXT${level ? ',"x":1' : ""}`],
  ["one more in every other", level => `"id":${level},${level % 2 ? '"x":1,' : ""}"name":"n${level}","next":NEXT`],
  ["another one in each", level => `"id":${level},"x${level}":1,"name":"n${level}","next":NEXT`],
  ["in another order", level => `"id":${level},"next":NEXT,"name":"n${level}"`],
  [
    "in another order in every other",
    level =>
      level % 2 ? `"id":${level},"next":NEXT,"name":"n${level}"` : `"id":${level},"x":0,"name":"n${level}","next":NEXT`,
  ],
  ["more behind the inner object", level => `"id":${level},"x":0,"name":"n${level}","next":NEXT,"y":1,"z":2`],
  ["the outermost lacks a member", level => `"id":${level},${level ? `"name":"n${level}",` : '"x":0,'}"next":NEXT`],
  [
    "an index behind the inner object",
    level => `"id":${level},"name":"n${level}",${level ? "" : '"x":0,'}"next":NEXT${level ? "" : ',"0":1'}`,
  ],
  [
    "a name twice behind the inner object",
    level => `"id":${level},"name":"n${level}",${level ? "" : '"x":0,'}"next":NEXT${level ? "" : ',"id":7'}`,
  ],
  [
    "an inner object twice",
    level => `"id":${level},"name":"n${level}",${level ? "" : '"x":0,"next":null,'}"next":NEXT`,
  ],
];
show("what each member holds", "item", '{"x":1,"id":0,"name":"a","next":{"id":5,"name":"b","next":null}}');
for (const [label, membersAt] of formsOfItems) {
  for (const times of [3, 2]) {
    for (let levels = 1; levels <= 6; levels++) {
      Bun.gc(true);
      show(label + ", " + levels + " deep", "item", list(levels, membersAt), times);
      show(
        "then the innermost in a list",
        "items",
        "[" + list(1, () => membersAt(levels - 1)) + "," + list(1, () => membersAt(levels - 1)) + "]",
        1,
      );
      show(
        "then the innermost two in a list",
        "items",
        "[" + list(2, level => membersAt(level + Math.max(levels - 2, 0))) + "]",
        1,
      );
      show(
        "then as declared",
        "items",
        '[{"id":3,"name":"c","next":null},{"id":4,"name":"d","next":{"id":5,"name":"e","next":null}}]',
        1,
      );
    }
  }
}
Bun.gc(true);
show(
  "the innermost begins with its last member",
  "item",
  '{"a":1,"id":1,"name":"r","next":{"next":null,"id":3,"name":"z"}}',
);
show(
  "three deep",
  "item",
  '{"id":1,"name":"a","x":1,"next":{"id":2,"name":"b","next":{"id":3,"name":"c","next":null}}}',
  2,
);
show(
  "the members of the innermost, then those of the outermost",
  "item",
  '{"id":9,"name":"n","next":null,"id":1,"name":"a","x":5,"next":{"next":null,"id":3,"name":"z"}}',
  2,
);

const formsOfTrees: [string, (level: number) => string][] = [
  ["as declared", level => `"value":${level},"left":LEFT,"right":RIGHT`],
  ["one more in each", level => `"value":${level},"x":1,"left":LEFT,"right":RIGHT`],
  ["one more in the outermost", level => `"value":${level},${level ? "" : '"x":1,'}"left":LEFT,"right":RIGHT`],
  ["one more between the inner objects", level => `"value":${level},"left":LEFT,"x":${level},"right":RIGHT`],
  [
    "the other way around in every other",
    level =>
      level % 2 ? `"value":${level},"right":RIGHT,"left":LEFT` : `"value":${level},"x":1,"left":LEFT,"right":RIGHT`,
  ],
];
show(
  "what each member holds",
  "tree",
  '{"x":1,"value":0,"left":{"value":1,"left":null,"right":null},"right":{"value":2,"left":null,"right":null}}',
);
for (const [label, membersAt] of formsOfTrees) {
  for (let levels = 1; levels <= 5; levels++) {
    Bun.gc(true);
    show(label + ", " + levels + " deep", "tree", tree(levels, membersAt));
    show(
      "then two in a list",
      "trees",
      "[" + tree(1, () => membersAt(levels - 1)) + "," + tree(2, level => membersAt(level + 1)) + "]",
      1,
    );
  }
}

const formsOfOwners: [string, (level: number) => string][] = [
  ["as declared", level => (level % 2 ? `"kind":"k${level}","owner":NEXT` : `"title":"t${level}","pet":NEXT`)],
  [
    "one more in each",
    level => (level % 2 ? `"kind":"k${level}","x":1,"owner":NEXT` : `"title":"t${level}","x":1,"pet":NEXT`),
  ],
  [
    "one more in the outermost",
    level => (level % 2 ? `"kind":"k${level}","owner":NEXT` : `"title":"t${level}",${level ? "" : '"x":1,'}"pet":NEXT`),
  ],
  [
    "one more at the beginning of each",
    level => (level % 2 ? `"x":1,"kind":"k${level}","owner":NEXT` : `"x":1,"title":"t${level}","pet":NEXT`),
  ],
];
show(
  "what each member holds",
  "owner",
  '{"x":1,"title":"a","pet":{"x":1,"kind":"b","owner":{"title":"c","pet":null}}}',
);
for (const [label, membersAt] of formsOfOwners) {
  for (let levels = 1; levels <= 6; levels++) {
    Bun.gc(true);
    show(label + ", " + levels + " deep", "owner", list(levels, membersAt));
    show("then the inner ones in a list", "pets", "[" + list(levels, level => membersAt(level + 1)) + "]", 1);
  }
}
