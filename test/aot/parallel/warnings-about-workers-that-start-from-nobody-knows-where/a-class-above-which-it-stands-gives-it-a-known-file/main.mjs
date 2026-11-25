// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
import { Made as Base } from "./made.mjs";
class Made extends Base {}
const made = new Made();
made.onmessage = event => {
  console.log(event.data);
  made.terminate();
};
