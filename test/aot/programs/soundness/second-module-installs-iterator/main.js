import { Bag, show } from "./bag.js";
import { run } from "./late.js";
const b = new Bag();
function use(tag) { try { for (const x of b) show(tag, x); } catch (e) { show(tag, "not iterable"); } show(tag, b + 1); }
use("first");
run();
use("second");
