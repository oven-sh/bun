import { createRequire } from "node:module";
const said = [];
for (let held of [name => "another " + name]) {
  said.push(held("./lib/part.cjs"));
  held = createRequire(import.meta.url);
  said.push(typeof held);
}
for (var key in { other: 1 }) {
  said.push(typeof key);
  key = createRequire(import.meta.url);
}
function take(held = name => "a default " + name) {
  const first = held("./lib/part.cjs");
  held = createRequire(import.meta.url);
  return first;
}
try {
  throw name => "thrown " + name;
} catch (held) {
  said.push(held("./lib/part.cjs"));
  held = createRequire(import.meta.url);
}
console.log("SAID", said.join(", "), take());
