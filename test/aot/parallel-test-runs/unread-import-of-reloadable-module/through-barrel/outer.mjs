import { inner } from "./inner.mjs";
export const outer = () => "outer " + (typeof inner === "function" ? inner() : inner);
