const holder = new Proxy({ api: Bun }, {});
console.log(holder.api.escapeHTML("<a>"));
