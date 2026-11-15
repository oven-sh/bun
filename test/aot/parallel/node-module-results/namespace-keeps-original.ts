import * as paths from "node:path";
import path from "path";
function total(count: number): string {
  let length = 0, text = "", other = 0;
  for (let i = 0; i < count; i++) {
    const joined = paths.join("a", "b" + i);
    if (typeof joined === "string") {
      length += joined.length;
      text += joined.charCodeAt(0);
    } else other++;
  }
  return [length, text, other].join();
}
console.log(total(9));
(path as any).join = () => 41;
console.log(path.join("g", "h"));
console.log(total(9), paths.join("c", "d"));
