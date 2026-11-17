// A loop whose values are read behind it, and then, in another loop, a chain of comparisons with written strings: in an inlined function that returns, in an if chain, in a conditional, nested twice.
function kindOf(x) { if (x === "get") return 1; if (x === "put") return 2; if (x === "post") return 3; if (x === "delete") return 4; return 0; }
let first = 0;
for (let turn = 0; turn < 3000; turn++) first += turn;
console.log(first);
const methods = JSON.parse('["get","put","post","delete","patch","ge"]');
methods.push("po" + "st".repeat(1), "get".slice(0));
let sum = 0;
for (let turn = 0; turn < 300; turn++) for (let i = 0; i < methods.length; i++) sum += kindOf(methods[i]);
console.log(sum);
function values(items, words) {
  let i = 0, s = 0;
  for (; i < items.length; i++) { if (items[i] === -7) break; s += items[i]; }
  let out = "";
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    let v;
    if (w === "get") v = i; else if (w === "put") v = s; else if (w === "post") v = i + s; else if (w === "delete") v = i * 100 + s; else v = -1;
    out += v + ",";
  }
  return out + i + "/" + s;
}
function twice(bytes, words) {
  let n = 0;
  while (n < bytes.length && bytes[n] !== 0) n++;
  let m = n;
  while (m < bytes.length && bytes[m] === 0) m++;
  const out = [];
  for (const w of words) {
    out.push(w === "get" ? n : w === "put" ? m : w === "post" ? n + m : w === "delete" ? m - n : kindOf(w) - 1);
    for (let k = n; k < m; k++) out.push(kindOf(w) * k);
  }
  return out.join(" ") + "|" + n + "/" + m;
}
function returned(text, words) {
  let p = 0;
  while (p < text.length && text.charCodeAt(p) === 32) p++;
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    if (w === "stop") return "s" + p;
    if (w === "here") return "h" + p * 2;
    if (w === "there") return "t" + (p + k);
    if (w === "back") { p--; k += 1; }
  }
  return "end" + p;
}
for (let n = 0; n < 20; n++) {
  const items = Array.from({ length: n }, (_, k) => (k === n - 3 ? -7 : k + (n & 1 ? 0.5 : 0)));
  console.log(values(items, methods), twice(Uint8Array.from({ length: n }, (_, k) => (k > n / 3 && k < n / 2 ? 0 : 1)), methods));
  console.log(returned(" ".repeat(n) + "x", ["a", "back", "b", ["stop", "here", "there", "none"][n & 3], "back"]));
}
