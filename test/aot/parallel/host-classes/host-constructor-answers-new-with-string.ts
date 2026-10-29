// `new CString(pointer)` of bun:ffi answers with a string primitive, not with an object: a native constructor may. What the compiler believes of `new` may not decide `typeof` and `===` on it.
import { CString, ptr } from "bun:ffi";
const bytes = Buffer.from("Hello, world!\0");
const text = new CString(ptr(bytes));
console.log(typeof text, text === "Hello, world!", text == "Hello, world!", text.length, typeof text === "string" ? "a string" : "no string", [text].includes("Hello, world!"));
function same(x: unknown, y: unknown) { return x === y; }
console.log(same(text, "Hello, world!"), `${text}` === "Hello, world!");
