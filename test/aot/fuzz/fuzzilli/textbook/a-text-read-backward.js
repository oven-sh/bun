function backward(text) {
  let out = "";
  for (let i = text.length - 1; i >= 0; i--) {
    out += text[i];
  }
  return out;
}
console.log(backward(JSON.parse('"harbor"')));
