import { name0, leafOf0 } from "./ring/m0.mjs";
import { throughStar } from "./ring/m40.mjs";
import { required } from "./leaf-that-requires.cjs";
ran.push("root");
export const describe = () => [name0, leafOf0(), throughStar(), required].join(" | ");
