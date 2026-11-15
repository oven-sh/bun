import { pair, lock } from "./item.ts";
import { draft } from "./draft.ts";
function run() {
  const first = pair("disk", 40);
  console.log(JSON.stringify(first), JSON.stringify(draft()));
  lock(first);
}
run();
