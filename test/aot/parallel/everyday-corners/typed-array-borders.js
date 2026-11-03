// Typed array borders: compiled answers as plain.
const u = new Uint8Array(2),
  c = new Uint8ClampedArray(2),
  i = new Int8Array(2),
  f = new Float32Array(1);
u[0] = 257;
u[1] = -1;
c[0] = 300;
c[1] = 1.5;
i[0] = 128;
i[1] = "7";
f[0] = 0.1;
u[5] = 1;
console.log(
  [...u, ...c, ...i].join(),
  f[0] === 0.1,
  u[5],
  u.length,
  5 in u,
  u[-1],
  u["1"],
  u["01"],
  Object.keys(u).join(),
);
