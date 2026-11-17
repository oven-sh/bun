import "./first.cjs";
import { a } from "./ring-a.mjs";
(globalThis.order ??= []).push("reads");
export const seen = () => a();
