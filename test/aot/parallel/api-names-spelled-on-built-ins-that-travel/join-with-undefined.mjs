const b = typeof Bun !== "undefined" ? Bun : undefined;
console.log(b?.escapeHTML("<a>"));
