"use strict";
class Counter { constructor() { this.n = 31; } }
globalThis.fromNested = new Counter().n;
