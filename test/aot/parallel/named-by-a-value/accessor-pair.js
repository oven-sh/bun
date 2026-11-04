const part = globalThis.never ? "x" : "a";
class Cell { #held = 1; get held() { return this.#held; } set held(value) { this.#held = value * 2; } }
const cell = new Cell(); cell[globalThis.never ? "" : "held"] = 4; console.log(JSON.stringify(cell, ["held"]));
