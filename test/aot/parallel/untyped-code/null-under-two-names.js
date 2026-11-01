const seen = [];
function f(a, b = a) {
  if (!a) {
    if (b === a) seen.push(a ?? "default");
    b ^= 1;
  } else a == b;
  return b?.[0]?.[0];
}
f(-1); f(1); f(""); f("1"); f(null);
console.log(seen.map(String).join());
