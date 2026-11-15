export const fixed = Symbol("fixed");
export const word = "word";
export let moving = Symbol("moving first");
export function move() { moving = Symbol("moving second"); return moving; }
export var late = Symbol("late");
export { fixed as renamed };
export default Symbol("default");
