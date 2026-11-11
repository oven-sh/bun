import * as reader from "./reader.js";
import { attempt } from "./show.js";
import { become } from "./state.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

function all(when) {
  for (const name in reader) attempt(when + " " + name, reader[name]);
}

let sum = 0;
for (let i = 0; i < 2000; i++) {
  sum += reader.size() + reader.first() + reader.walked().length + reader.throughTheAlias();
  if (i % 500 === 0) sum += reader.pushed();
}
console.log("sum", sum);
all("a list");
const kinds = {
  "a text": "text",
  "an array-like": { length: 5, 0: "z" },
  "a number": 7,
  "null": null,
  "undefined": undefined,
  "a function": function five() {
    return 5;
  },
  "a map": new Map([[0, "zero"]]),
  "an object with valueOf": { valueOf: () => 20, length: "long" },
  "a list again": [4, 5],
};
for (const when in kinds) {
  become(kinds[when]);
  all(when);
}
