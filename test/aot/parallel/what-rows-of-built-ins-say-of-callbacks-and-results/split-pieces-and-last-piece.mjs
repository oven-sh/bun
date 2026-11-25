let work = 0;
function pieces(text, separator) { for (let i = 0; i < 2; i++) work = (work + i) | 0; return text.split(separator).length; }
function last(text, separator) { for (let i = 0; i < 2; i++) work = (work + i) | 0; return text.split(separator).pop(); }
function lastAt(text, separator) { for (let i = 0; i < 2; i++) work = (work + i) | 0; return text.split(separator).at(-1); }
for (const [text, separator] of [["abc", ""], ["", ""], ["a,b", ","], ["", ","], ["aaa", "aa"], ["abc", "abc"], ["a.b.c", "."]])
  console.log(JSON.stringify([text, separator]), pieces(text, separator), JSON.stringify(last(text, separator)), JSON.stringify(lastAt(text, separator)));
console.log("path/to/file.txt".split("/").pop(), "path/to/file.txt".split("/").length, "x".split("").length, "xy".split("").pop());
