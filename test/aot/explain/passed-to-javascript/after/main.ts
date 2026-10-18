import { log } from "./log.js";

interface Box {
  width: number;
  height: number;
}

function area(box: Box): number {
  return box.width * box.height;
}

const box: Box = { width: 3, height: 4 };
log({ ...box });
console.log(area(box));
