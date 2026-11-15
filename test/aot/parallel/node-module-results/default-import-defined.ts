import path from "node:path";
function total(count: number): string {
  let length = 0, text = "", other = 0;
  for (let i = 0; i < count; i++) {
    const joined = path.join("a", "b" + i);
    if (typeof joined === "string") {
      length += joined.length;
      text += joined.charCodeAt(0);
    } else other++;
  }
  return [length, text, other].join();
}
console.log(total(9));
Object.defineProperty(path, "join", { get: () => (...parts: string[]) => parts.length });
console.log(total(9), path.join("c", "d"));
