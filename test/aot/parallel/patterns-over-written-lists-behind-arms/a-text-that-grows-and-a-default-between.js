const unseen = (x) => [x][JSON.parse("0")];
function take(n, give) {
  let s = "";
  for (let i = 0; i < n; i++) s += "k" + i;
  const [a = give(s), b, c] = [undefined, s, n];
  s += "!";
  return a + ":" + b + ":" + c + ":" + s;
}
console.log(take(3, unseen((t) => t.length)), take(1, unseen((t) => t + t)));
