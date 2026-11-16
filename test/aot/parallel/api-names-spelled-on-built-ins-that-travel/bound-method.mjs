const escape = Bun.escapeHTML.bind(Bun);
console.log(escape("<a>"));
