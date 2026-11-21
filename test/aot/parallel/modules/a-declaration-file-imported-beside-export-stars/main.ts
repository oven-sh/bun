// A file that imports a declaration file by name builds also where the program has `export *`.
import "./amount.d.ts";
import * as barrel from "./barrel.ts";
import { add } from "./barrel.ts";

const amount: Amount = 4;
console.log(add(amount), Object.keys(barrel).join());
