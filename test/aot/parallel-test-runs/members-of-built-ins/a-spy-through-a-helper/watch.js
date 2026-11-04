import { spyOn } from "bun:test";

export const watch = (holder, name) => spyOn(holder, name);
