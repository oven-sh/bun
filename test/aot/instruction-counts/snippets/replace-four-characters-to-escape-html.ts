// escapes a string for HTML with four replaces, of which two find something
const operations = 20;
const words: string[] = [];
for (let i = 0; i < operations; i++) words.push("<b>bold</b> text " + i + " & more");
let total = 0;

kernel: {
  let length = 0;
  for (let i = 0; i < words.length; i++)
    length += words[i].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").length;
  total += length;
}

console.log(total);
