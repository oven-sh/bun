const holder = new Proxy({}, { get: () => Bun });
console.log(holder.anything.escapeHTML("<a>"));
