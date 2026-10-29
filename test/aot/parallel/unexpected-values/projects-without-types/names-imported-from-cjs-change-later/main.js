import * as reader from "./reader.js";
import { attempt } from "./show.js";
import state from "./state.cjs";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

function all(when) {
  for (const name in reader) attempt(when + " " + name, reader[name]);
}
all("at first");
for (let i = 0; i < 2000; i++) {
  reader.byName();
  reader.throughTheDefault();
  reader.throughTheNamespace();
}
state.changeInPlace();
all("changed in place");
state.change();
all("changed");
