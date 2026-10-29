import third, { name as nameOfThird } from "./third.cjs";
import * as second from "./second.cjs";
export const name = "fifth";
export const seen = () => [nameOfThird, third.list.join("+"), Object.keys(second).sort().join("+")].join(" ");
