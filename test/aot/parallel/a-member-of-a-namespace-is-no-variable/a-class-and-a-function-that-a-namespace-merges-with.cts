class Kit { static base = 1; }
namespace Kit {
  export var size = "of the class";
  export function peek() { return size; }
}
function tool() { return 1; }
namespace tool {
  export var size = "of the function";
  export function peek() { return size; }
}
const ofClass = Kit.peek, ofFunction = tool.peek;
// @ts-ignore
Kit = { size: "another object" };
// @ts-ignore
tool = { size: "another object" };
console.log(ofClass(), ofFunction());
