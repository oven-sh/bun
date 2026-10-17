import type { Line, Row } from "./types";
function handOn(line: Line): Line {
  return line;
}
export function pass(row: Row): Line {
  return handOn(row);
}
