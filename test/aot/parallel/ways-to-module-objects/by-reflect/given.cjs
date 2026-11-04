"use strict";
const above = { hello() { return "hello"; } };
Reflect.defineProperty(module, "exports", { get() { return Object.create(above); } });
