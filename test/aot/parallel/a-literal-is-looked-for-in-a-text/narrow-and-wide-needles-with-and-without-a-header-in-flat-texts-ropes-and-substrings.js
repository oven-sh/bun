const holder = { key: 1, needle: 2 };
const long = "0123456789".repeat(30) + "abc" + "key" + "中文" + "needle" + "abc";
function joined(a, b) { return a + b; }
const texts = [
  "", "a", "abc", "abcabc", "xabcx", "key", "a key and a needle", "中文", "a中文b中文",
  "x".repeat(40) + "abc", joined("x".repeat(300) + "ab", "c" + "y".repeat(300)), joined(joined("ke", "y"), joined("need", "le")),
  joined("中".repeat(200), "文abc" + "z".repeat(200)), long.slice(3, 310), long.slice(295), long.substring(300, 303), long.slice(306, 308),
];
const lines = [];
for (const text of texts) {
  lines.push([
    text.indexOf("abc"), text.indexOf("abc", 1), text.indexOf("abc", -5), text.indexOf("abc", 1000), text.indexOf("abc", text.length),
    text.lastIndexOf("abc"), text.lastIndexOf("abc", 1), text.lastIndexOf("abc", -5), text.lastIndexOf("abc", 1000), text.lastIndexOf("abc", 0),
    text.includes("abc"), text.includes("abc", 4), text.startsWith("abc"), text.endsWith("abc"), text.split("abc").length,
    text.indexOf("key"), text.lastIndexOf("key"), text.includes("key"), text.indexOf("needle"), text.lastIndexOf("needle", 7), text.split("key").length,
    text.indexOf("中文"), text.indexOf("中文", 2), text.lastIndexOf("中文"), text.lastIndexOf("中文", 1), text.includes("中文"), text.split("中文").length,
    text.indexOf(""), text.indexOf("", 2), text.indexOf("", 1000), text.lastIndexOf(""), text.lastIndexOf("", 2), text.includes(""), text.split("").length,
    text.indexOf("c"), text.lastIndexOf("c"), text.indexOf("文"), text.lastIndexOf("文"),
    text.indexOf("abcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabc"), text.lastIndexOf("abcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabc"),
  ].join(","));
}
console.log(lines.join("\n"));
console.log(holder.key + holder.needle);
