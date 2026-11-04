const seen = [];
function f(a, b = a) {
  if (!a) {
    if (b === a) seen.push(a ?? "default");
    b ^= 1;
  } else a == b;
  return b?.[0]?.[0];
}
function g(a, b = a) {
  if (!a) {
    if (a === b) seen.push(typeof (a ?? "default"));
    b ^= 1;
  } else a == b;
  return b?.[0]?.[0];
}
for (const call of [f, g]) {
  call(-1); call(1); call(""); call("1"); call(null);
}
console.log(seen.map(String).join());
