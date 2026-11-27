import { value } from "dep";
(globalThis.order ??= []).push("reads");
export const seen = () => value();
