import { twice } from "./helper";
export function make() {
  const text = "}";
  const pattern = /[}]/;
  return { width: twice(text.length), name: `${pattern.source}}` };
}
export type Made = ReturnType<typeof make>;
