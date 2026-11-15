import { a, n } from "./lib.cjs";
import * as all from "./lib.cjs";
export const seen = () => [a, n, all.a, Object.keys(all).sort().join("+")].join(",");
