import * as barrel from "./barrel.mjs";
import { make } from "./barrel.mjs";
console.log(Object.keys(barrel).join());
console.log(typeof barrel.make, barrel.title, make().length);
