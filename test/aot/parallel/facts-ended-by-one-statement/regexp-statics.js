const dates = ["2024-05-06", "2025-11-30"];
let text = "";
for (const date of dates) {
  /(\d+)-(\d+)/.test(date);
  text += RegExp.$1 + "/" + RegExp.$2 + ";";
}
console.log(text, RegExp.lastMatch, RegExp["$'"]);
