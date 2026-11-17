import { value } from "dep";
import { wrapped } from "./wrap.mjs";
export const own = () => value() + " " + wrapped();
