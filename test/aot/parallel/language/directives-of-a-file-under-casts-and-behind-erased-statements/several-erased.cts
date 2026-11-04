import type Path = require("node:path");
type A = Path.ParsedPath;
interface I { a: A }
declare const x: I;
"first";
import type Fs = require("node:fs");
"use strict" as any;
console.log("behind several erased statements:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
