import { greet } from "./dep.cjs";
import * as dep from "./dep.cjs";
export const useGreet = () => greet();
export const viaSpace = () => dep.greet();
