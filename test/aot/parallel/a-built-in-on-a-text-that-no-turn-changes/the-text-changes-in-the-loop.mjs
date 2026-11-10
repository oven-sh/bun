let q = JSON.parse('"AbC"');
const out = [];
for (let i = 0; i < 6; i++) { out.push(q.toLowerCase(), q.trim().length, q.slice(1, 3)); if (i === 2) q = " XyZ "; if (i === 4) q += "Q"; }
console.log(out.join());
