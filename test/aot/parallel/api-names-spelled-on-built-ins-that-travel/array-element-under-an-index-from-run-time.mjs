const list = [Bun, Bun];
console.log(list[process.argv.length > 99 ? 0 : 1].escapeHTML("<a>"));
