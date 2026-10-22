import { name } from "./cycle-a.mjs";
import { three } from "./leaf-three.cjs";
ran.push("cycle-b");
export const b = () => "b(" + name + ")+" + three;
