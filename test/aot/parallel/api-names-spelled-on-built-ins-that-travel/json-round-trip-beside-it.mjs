const options = JSON.parse('{"name":"api"}');
const table = { api: Bun };
console.log(table[options.name].escapeHTML("<a>"));
