import { none } from "./deep/lib.ts";
export function first(list: number[]): number {
  return list.length ? list[0] : none();
}
