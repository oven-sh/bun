import path from "path";
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
new Function("path", "path.join = () => ({ length: 3 })")(path);
console.log(total(9), path.join("c", "d"));
