"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const implementation = { helper() { return 1; } };
globalThis.effects = ["body"];
Object.defineProperty(exports, "helper", { enumerable: true, get: function () { globalThis.effects.push("getter"); return implementation.helper; } });
