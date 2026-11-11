import early from "./crate.cjs";
const { default: late, shown } = await import("./crate.cjs");
console.log(String(early), String(late), String(shown));
