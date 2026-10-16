// A directive is told by its text, not by its value: `"use strict"` or `'use strict'`, those twelve characters, as a statement of its own at the start of a body.
// A string with an escape or a line continuation in it, one in parentheses, and a template have the same value and are no directive: the function stays sloppy.
import { answers } from "./sloppy.cjs";
console.log(answers());
