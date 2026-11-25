import * as self from "./part";
(globalThis.order ??= []).push("part");
export const name = "real";
export function fn() { return "fn"; }
export const peek = () => self.name;
