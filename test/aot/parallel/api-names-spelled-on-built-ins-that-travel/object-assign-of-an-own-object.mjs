const copy = Object.assign({}, { api: Bun });
console.log(copy.api.escapeHTML("<a>"));
