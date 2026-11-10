export namespace Box {
  export var size = "member";
  export function peek() { return size; }
}
export const peek = Box.peek;
// @ts-ignore
export function swap() { Box = { size: "another object" }; }
