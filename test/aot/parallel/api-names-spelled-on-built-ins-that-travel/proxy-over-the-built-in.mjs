const b = new Proxy(Bun, {});
console.log(b.escapeHTML("<a>"));
