import "./first.cjs";
import { w } from "./w.mjs";
import { x } from "./x.mjs";
(globalThis.order ??= []).push("reads");
export const seen = () => w() + x();
