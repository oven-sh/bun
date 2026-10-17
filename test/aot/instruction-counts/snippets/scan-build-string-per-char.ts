// builds a string by += of one character of another string at a time
const operations = 100;
const pattern = "the quick brown fox jumps over the lazy dog, ";
let text = "";
for (let i = 0; i < operations - 0; i++) text += pattern[i % pattern.length];
let total = 0;

kernel: {
  let out = "";
  for (let i = 0; i < text.length; i++) out += text[i];
  total += out.length;
}

console.log(total);
