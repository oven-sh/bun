function title(text) {
  return text
    .split(" ")
    .filter(Boolean)
    .map(word => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
console.log(title(JSON.parse('"the  qUICK brown fox"')));
