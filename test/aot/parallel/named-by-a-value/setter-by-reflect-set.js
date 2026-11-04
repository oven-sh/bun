const part = globalThis.never ? "x" : "a";
class Cell { stored = 0; set held(value) { this.stored = value; } }
const cell = new Cell(); Reflect.set(cell, "he" + (globalThis.never ? "" : "ld"), 4); Object.assign(cell, { held: cell.stored + 1 }); console.log(cell.stored);
