const part = JSON.parse('"AbC"');
const rope = part + "-" + part + "-" + part.repeat(20);
const out = [];
for (let i = 0; i < 5; i++) { out.push(rope.toLowerCase().length + rope.slice(2, 9) + rope.trim().length); if (i === 2) Bun.gc(true); }
console.log(out.join());
