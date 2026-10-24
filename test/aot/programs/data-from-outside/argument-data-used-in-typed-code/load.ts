import type { Row } from "./types";
export function load(text: string): Row {
  return JSON.parse(text) as Row;
}
