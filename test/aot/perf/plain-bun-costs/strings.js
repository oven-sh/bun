let sum = 0, text = "";
for (let i = 0; i < 120000; i++) {
  text += String.fromCharCode(97 + (i % 26));
  if (text.length > 400) { sum += text.charCodeAt(7) + text.indexOf("xyz") + text.slice(10, 90).toUpperCase().length; text = ""; }
}
const words = [];
for (let i = 0; i < 30000; i++) words.push(`word-${i.toString(36)}-${(i * 7919) % 1000}`);
const line = words.join(" ");
sum += line.split(" ").length + line.replaceAll("-", "_").length + line.lastIndexOf("word-zz");
for (const word of words) {
  sum += word.padStart(24, ".").trim().length + word.split("-")[1].length + (word.startsWith("word-a") ? 1 : 0) + word.localeCompare("word-m");
  sum += encodeURIComponent(word + " é").length + Number.parseInt(word.slice(-3), 10) || 0;
}
for (let i = 0; i < 60000; i++) sum += (i * 1.5).toString().length + (i / 7).toFixed(3).length + String(i).at(-1).length;
console.log(sum);
