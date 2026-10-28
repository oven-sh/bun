import { Color } from "./color";
const n = process.argv.length > 99 ? 0 : 1;
console.log(Color[n], Color.Green, "Red" in Color);
for (const key in Color) console.log(key);
