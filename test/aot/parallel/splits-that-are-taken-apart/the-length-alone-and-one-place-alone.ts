// What is printed is what plain Bun prints.
const count = (text: string) => text.split(",").length;
const second = (text: string) => text.split(",")[1];
const wide = (text: string) => text.split("中").length + ":" + text.split("中")[1];
console.log("SAID " + ["", ",", "a,b,c", ",,,,", "no"].map(text => count(text) + ":" + second(text)).join(" ") + " " + ["plain", "a中b中c", "中"].map(wide).join(" "));
