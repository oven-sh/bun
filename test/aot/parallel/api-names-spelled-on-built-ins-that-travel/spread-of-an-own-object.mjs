const copy = { ...{ api: Bun } };
console.log(copy.api.escapeHTML("<a>"));
