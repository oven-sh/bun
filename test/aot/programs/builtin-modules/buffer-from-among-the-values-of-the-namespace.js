// Buffer.from is written in JavaScript. This program finds Buffer among the values of the namespace object of node:buffer, under a key that nobody can name.
import * as buffer from "node:buffer";
for (const value of Object.values(buffer)) if (typeof value === "function" && value.name === "Buffer") console.log(value.from("abc").length);
