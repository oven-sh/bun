// Bindings that reach the reader through other modules.
import { one, two, three } from "./barrel";
import * as barrel from "./barrel";
console.log(one.n, two.n, three().n, Object.keys(barrel).sort().join(), one === barrel.one);
