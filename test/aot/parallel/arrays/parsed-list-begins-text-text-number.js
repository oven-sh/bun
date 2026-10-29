// Each line is parsed into a list. The first element says what the rest means: it is compared with a text, then with a number, and the elements behind it are read as numbers.
let out = "";
for (const line of ["[\"p\",1]", "[3,0]"]) {
  const c = JSON.parse(line);
  const key = c[0] === "p" ? "p:" : c[0] === 3 ? "D" + c[1] : "L" + c[8];
  out += key + (c[9] > 0 ? c[9] * 0.5 : 0) + "; ";
}
console.log(out);
