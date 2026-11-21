// node:stream/consumers keeps the JSON.parse that it found while it loaded, at the link: a replacement that the body stores sees no call when json() parses.
import { json } from "node:stream/consumers";
import { Readable } from "node:stream";
const calls = [];
const parse = JSON.parse;
JSON.parse = (...args) => {
  calls.push("JSON.parse");
  return parse(...args);
};
const value = await json(Readable.from(['{"a":1}']));
console.log(value.a, calls.join(", ") || "no call");
console.log(JSON.parse("2"), calls.join(", "));
