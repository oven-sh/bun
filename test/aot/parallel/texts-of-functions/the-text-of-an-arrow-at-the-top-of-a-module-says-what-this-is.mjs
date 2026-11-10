// `this` at the top of a file is no `this` of a function: it is null in a file with import or export, as under `bun run`, and the text of an arrow says so.
// Until then the text held `this`, which is the global object where the text is evaluated again.
import { basename } from "node:path";
const again = text => (0, eval)("(" + text + ")");
const forms = [
  () => this,
  () => [this, typeof this, this?.x, (() => this)()],
  () => ({ held: this }).held,
  async () => this,
  () => {
    "use strict";
    return this;
  },
];
for (const form of forms) console.log(JSON.stringify(await again(form)()), JSON.stringify(await form()));
// The `this` of a function, of a method and of a field stays.
function own() {
  return (() => this)();
}
class Kept {
  field = () => this;
}
console.log(again(own).call(7), new (again(Kept))().field() instanceof Kept, basename("a/b"));
