"use strict";
const impl = { add: (a, b) => (a + b) | 0, low: a => a & 15 };
for (const name in impl) Object.defineProperty(exports, name, { enumerable: true, configurable: true, get: () => impl[name] });
