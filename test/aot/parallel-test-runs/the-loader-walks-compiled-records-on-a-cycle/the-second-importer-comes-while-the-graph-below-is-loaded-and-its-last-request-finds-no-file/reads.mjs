import "./first.cjs";
import { a } from "./a.mjs";
import { one as p } from "./path-one.mjs";
(globalThis.order ??= []).push("reads");
export const seen = () => a() + p();
