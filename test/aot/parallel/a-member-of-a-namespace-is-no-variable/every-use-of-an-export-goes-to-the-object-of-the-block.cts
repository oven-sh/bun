// The name of the namespace is stored to, and then the code of the block reads, calls, stores and deletes what the block exports.
namespace Box {
  export var size = "member";
  export var tag = "of the block";
  export var who = function (this: any) { return this.tag; };
  export function peek() { return typeof size + " " + size + " " + who(); }
  export function grow() { size = "grown"; size += "!"; }
  // @ts-ignore
  export function drop() { return delete tag; }
  export class Item { held = size; peek() { return size; } }
  export function* walk() { yield size; yield size; }
  export async function later() { await null; return size; }
}
const { peek, grow, drop, Item } = Box, first: any = Box, walk = Box.walk(), later = Box.later();
console.log(walk.next().value);
// @ts-ignore
Box = { size: "another object", tag: "another tag" };
console.log(peek(), new Item().held, new Item().peek(), walk.next().value);
grow();
console.log(first.size, Box.size, drop(), "tag" in first, "tag" in Box);
later.then(value => console.log(value));
