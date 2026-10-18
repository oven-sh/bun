import type { Box } from "./box";

function area(box: Box): number {
  return box.width * box.height;
}

console.log(area({ width: 3, height: 4 }));
