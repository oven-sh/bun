function runs(text) {
  let out = "";
  let count = 1;
  for (let i = 1; i <= text.length; i++) {
    if (i < text.length && text[i] === text[i - 1]) count++;
    else {
      out += text[i - 1] + count;
      count = 1;
    }
  }
  return out;
}
console.log(runs(JSON.parse('"aaabbbccd"')));
