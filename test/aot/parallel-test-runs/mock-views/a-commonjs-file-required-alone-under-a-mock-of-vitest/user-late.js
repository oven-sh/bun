import { flag, plain } from "./dep.cjs";
import * as ns from "./dep.cjs";
export const values = () => [flag, plain, ns.flag, Object.keys(ns).sort().join("+")].join();
