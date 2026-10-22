import { a } from "./cycle-a.mjs";
import { one } from "./leaf-one.cjs";
import { shared } from "./shared.mjs";
import * as barrel from "./barrel.mjs";
ran.push("first");
export const describe = () => [a(), one, shared, Object.keys(barrel).join()].join(" | ");
