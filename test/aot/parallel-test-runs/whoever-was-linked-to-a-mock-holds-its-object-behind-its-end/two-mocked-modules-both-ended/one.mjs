import * as dep from "dep";
import * as other from "./other.cjs";
const keys = it => it.value() + ":" + Object.keys(it).sort().join("+");
export const seen = () => keys(dep) + " " + keys(other);
