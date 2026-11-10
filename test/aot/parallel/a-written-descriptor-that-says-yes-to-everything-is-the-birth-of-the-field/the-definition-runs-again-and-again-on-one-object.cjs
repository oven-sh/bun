"use strict";
class Cell { constructor() { this.put(0); } put(value) { Object.defineProperty(this, "held", { enumerable: true, configurable: true, writable: true, value: value }); return this; } }
const cell = new Cell(); let said = 0;
for (let turn = 0; turn < 20000; turn++) said = (said + cell.put(turn & 15).held) % 1000003;
cell.put("text"); console.log(said, cell.held, Object.keys(cell).join());
