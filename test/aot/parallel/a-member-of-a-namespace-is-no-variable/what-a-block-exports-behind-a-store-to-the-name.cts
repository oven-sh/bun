// The first initializer stores to the name. The variables, the function, the class, the enum, the alias and the names of the pattern all go to the object of the block.
namespace Other { export var thing = "thing"; }
let block: any;
// @ts-ignore
function swap() { block = Box; Box = { size: "another object" }; return "member"; }
namespace Box {
  export var size = swap();
  export const { width, depth } = { width: 1, depth: 2 };
  export function peek() { return size; }
  export class Item {}
  export enum Level { Low }
  export import alias = Other.thing;
}
console.log(Object.keys(Box).join(), Object.keys(block).join());
