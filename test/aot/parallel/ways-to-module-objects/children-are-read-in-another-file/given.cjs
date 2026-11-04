"use strict";
const above = { hello() { return "hello"; } };
Object.defineProperty(module, "exports", { get() { return Object.create(above); } });
