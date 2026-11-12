// An enum of the file itself, read under a key from outside through what an export helper fills.
var __defProp = Object.defineProperty;
var __export = (target: any, all: any) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var H: any = {};
__export(H, { Color: () => Color, add: () => add });
enum Color { Red, Green }
function add(a: number, b: number) { return a + b; }
console.log(H.Color[process.argv.length > 99 ? 1 : 0], H.Color.Green, H.add(1, 2));
