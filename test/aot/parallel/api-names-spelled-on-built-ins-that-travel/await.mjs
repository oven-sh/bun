const b = await Promise.resolve(Bun);
console.log(b.escapeHTML("<a>"));
