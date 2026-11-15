const said: unknown[] = [];
const show = (v: unknown) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
for (let turn = 0; turn < 300; turn++) { said.length = 0;
  const grows = [1, 2]; for (const [i, x] of grows.entries()) { said.push(i, x); if (grows.length < 5) grows.push(x * 10); }
  const shrinks = [1, 2, 3, 4]; for (const [i, x] of shrinks.entries()) { said.push(i, x); shrinks.pop(); }
  const cut = [1, 2, 3, 4]; for (const i of cut.keys()) { said.push(i); if (i === 1) cut.length = 2; }
  const written = [1, 2, 3]; for (const [i, x] of written.entries()) { said.push(x); if (i < 4) written[i + 1] = ("w" + i) as never; }
  const kinds: unknown[] = [1, 2, 3]; for (const [i, x] of kinds.entries()) { said.push(i, x); if (i === 0) kinds[2] = { o: 1 }; if (i === 1) kinds[5] = 0.5; }
}
console.log(said.map(show).join(" "));
