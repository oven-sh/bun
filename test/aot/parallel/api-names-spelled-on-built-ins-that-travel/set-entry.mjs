const set = new Set([Bun]);
for (const b of set) console.log(b.escapeHTML("<a>"));
