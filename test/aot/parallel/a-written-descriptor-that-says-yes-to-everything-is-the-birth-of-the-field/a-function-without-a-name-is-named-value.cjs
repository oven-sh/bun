"use strict";
class Tool { constructor() { Object.defineProperty(this, "run", { enumerable: true, configurable: true, writable: true, value: function () { return 1; } }); Object.defineProperty(this, "walk", { enumerable: true, configurable: true, writable: true, value: () => 2 }); Object.defineProperty(this, "kind", { enumerable: true, configurable: true, writable: true, value: class {} }); } }
let said = 0; for (let turn = 0; turn < 2000; turn++) { const tool = new Tool(); said += tool.run() + tool.walk(); }
const tool = new Tool(); console.log(said, tool.run.name, tool.walk.name, tool.kind.name);
