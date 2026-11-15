import { barrel } from "./barrel.mjs";
import { leaf } from "./leaf.mjs";
import { other } from "./other.mjs";
export const entry = () => [barrel(), leaf(), other()].join(" ");
