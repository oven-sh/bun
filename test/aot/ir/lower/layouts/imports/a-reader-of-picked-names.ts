import type { Wide } from "./item-with-a-place";

export function read(picked: Pick<Wide, "id" | "title">) {
  return picked.id;
}
