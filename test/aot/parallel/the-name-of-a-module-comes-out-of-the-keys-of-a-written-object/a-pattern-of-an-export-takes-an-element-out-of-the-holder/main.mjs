import "./c.mjs";
import { entry, load } from "./a.mjs";
entry.path = "./c.mjs";
console.log(await load());
