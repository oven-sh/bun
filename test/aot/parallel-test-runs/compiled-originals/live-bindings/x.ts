console.log("SAID body");
export let n = 0;
export function f() { return ++n; }
export { n as again };
export default class Box { static made = 0; #v = 1; constructor() { Box.made++; } get v() { return this.#v + n; } }
