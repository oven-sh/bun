const holder = { aLongPropertyName: 1, anotherLongPropertyName: 2 };
const long = "0123456789".repeat(30) + "/node_modules/" + "aLongPropertyName" + "中文字符串在这里呀呀" + "/node_modules/" + "tail of the text";
function joined(a, b) { return a + b; }
const texts = [
  "", "/node_modules", "/node_modules/", "a/node_modules/b/node_modules/c", "aLongPropertyName", "x aLongPropertyName y anotherLongPropertyName z",
  "中文字符串在这里呀呀", "a中文字符串在这里呀呀b/node_modules/",
  "x".repeat(40) + "/node_modules/", joined("x".repeat(300) + "/node_mo", "dules/" + "y".repeat(300)), joined(joined("aLongProp", "ertyName"), joined("/node_", "modules/")),
  joined("中".repeat(200), "/node_modules/" + "z".repeat(200)), long.slice(3, 330), long.slice(295), long.substring(300, 314), long.slice(301, 313), long,
];
const lines = [];
for (const text of texts) {
  lines.push([
    text.indexOf("/node_modules/"), text.indexOf("/node_modules/", 1), text.indexOf("/node_modules/", -5), text.indexOf("/node_modules/", 1000), text.indexOf("/node_modules/", text.length),
    text.lastIndexOf("/node_modules/"), text.lastIndexOf("/node_modules/", 1), text.lastIndexOf("/node_modules/", -5), text.lastIndexOf("/node_modules/", 1000), text.lastIndexOf("/node_modules/", 0),
    text.includes("/node_modules/"), text.includes("/node_modules/", 4), text.startsWith("/node_modules/"), text.endsWith("/node_modules/"), text.split("/node_modules/").length,
    text.indexOf("aLongPropertyName"), text.lastIndexOf("aLongPropertyName"), text.includes("anotherLongPropertyName"), text.lastIndexOf("anotherLongPropertyName", 30), text.split("aLongPropertyName").length,
    text.indexOf("中文字符串在这里呀呀"), text.lastIndexOf("中文字符串在这里呀呀"), text.includes("中文字符串在这里呀呀"), text.split("中文字符串在这里呀呀").length,
    text.indexOf("0123456789012"), text.indexOf("0123456789012", 15), text.lastIndexOf("0123456789012"), text.lastIndexOf("0123456789012", 15), text.split("0123456789012").length,
    text.indexOf("tail of the text"), text.lastIndexOf("tail of the text"), text.endsWith("tail of the text"), text.includes("tail of the texts"),
  ].join(","));
}
console.log(lines.join("\n"));
console.log(holder.aLongPropertyName + holder.anotherLongPropertyName);
