const fallback = { escapeHTML: text => text };
const b = process.argv.length > 99 ? fallback : Bun;
console.log(b.escapeHTML("<a>"));
