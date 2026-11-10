function moved(text, by) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out += code >= 97 && code <= 122 ? String.fromCharCode(((code - 97 + by) % 26) + 97) : text[i];
  }
  return out;
}
console.log(moved(JSON.parse('"hello, world"'), 3));
