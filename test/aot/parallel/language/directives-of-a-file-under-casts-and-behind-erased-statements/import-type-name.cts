declare namespace N { type B = 1 }
// @ts-ignore
import type A = N.B;
"use strict";
console.log("behind import type = a name:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
