const q = JSON.parse('"  MiXed "');
function* each(n) { for (let i = 0; i < n; i++) yield q.trim().toLowerCase() + i; }
async function later(n) { let s = ""; for (let i = 0; i < n; i++) { try { s += q.toUpperCase().slice(2, 4); if (i === 1) await null; if (i === 2) throw new Error("x"); } catch (e) { s += e.message; } } return s; }
console.log([...each(3)].join(), await later(4));
