// Members that are listed: keyed one. It prints what plain Bun prints.
import path from "node:path";
type Style = { alignItems?: string; alignSelf?: string; color?: string; width?: number; height?: number; margin?: number; padding?: number; bold?: boolean };
function make(i: number): Style {
  return { alignItems: "center", alignSelf: "end", color: "red", width: i, height: i + 1, margin: 2, padding: 3, bold: (i & 1) === 0 };
}
const styles: Style[] = [make(1), make(2), make(3), make(4)];
const keys = ["alignItems", "width", "color", "bold", "height", "margin", "alignSelf", "padding"];
function differs(a: any, b: any, key: string): boolean {
  return a[key] !== b[key];
}
const rounds = Number(process.argv[3] ?? 200000);
let sum = 0;
for (let i = 0; i < rounds; i++) {
  if (!path.isAbsolute("/a")) continue;
  if (differs(styles[i & 3], styles[(i + 1) & 3], keys[i & 7])) sum++;
}
console.log(sum > 0, rounds);
