function source(cases) {
  let text = "let a = seed | 0, b = 1.5, c = 'x', o = { p: 1, q: 2 }, list = [1, 2, 3];\nfor (let i = 0; i < rounds; i++) {\n switch ((a + i) % " + cases + ") {\n";
  for (let k = 0; k < cases; k++)
    text += ` case ${k}: { const t${k} = (a ^ ${k * 37}) + i; if (t${k} & ${1 << (k % 8)}) { a = (a + t${k} * ${k + 1}) | 0; b += t${k} / ${k + 2}; } else if (t${k} % 3) { o.p = (o.p + ${k}) | 0; list[${k % 3}] = t${k} & 255; } else { a = (a - o.q + list[${(k + 1) % 3}]) | 0; c = c.length > 8 ? "x" : c + "y"; } for (let j = 0; j < ${(k % 3) + 1}; j++) a = (a + Math.imul(j + 1, t${k})) | 0; break; }\n`;
  return text + " }\n}\nreturn a + Math.floor(b) + c.length + o.p + list[0] + list[1] + list[2];";
}
let sum = 0;
for (const cases of [20, 120, 400]) {
  const run = new Function("seed", "rounds", source(cases));
  for (let call = 0; call < 40; call++) sum = (sum + run(call, 6000)) | 0;
}
console.log(sum);
