// A string that is built and read back by index in the same loops
function echo(seed, rounds) {
  let text = seed;
  let sum = 0;
  for (let r = 0; r < rounds; r++) {
    for (let i = text.length - 1; i >= 0 && text.length < 60; i -= 2) {
      sum += text.charCodeAt(i);
      text += text[i] === text[i - 1] ? "." : text[i];
    }
    text = text.slice(1) + r;
  }
  return text + " " + sum;
}
console.log(echo("abc", 3));
console.log(echo("aa", 5));
console.log(echo("", 2), echo("éx😀", 2));
