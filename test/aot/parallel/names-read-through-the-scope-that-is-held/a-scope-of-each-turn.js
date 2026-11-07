const out = [];
for (let i = 0; i < 3; i++) {
  const twice = i * 2;
  let count = 0;
  out.push({ bump: () => ++count + twice, read: () => count + ":" + twice + ":" + i });
}
for (const o of out) console.log(o.bump(), o.bump(), o.read());
