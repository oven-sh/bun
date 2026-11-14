// An untyped package and a program of it (rows): a template becomes the source of a function; here the function is built from closures, not from text
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var t = lib.compile('<% each row in rows -%>\n<%= index %>:<%= row.name | upper %><% if row.tags %>[<% each t in row.tags %><%- t %>;<% end %>]<% else %> none<% end %> <%= row.price | fixed(2) | pad(8) %>\n<% end %>total <%= rows | size %> <%# no %>');
for (var i = 0; i < 12; i++) { var rows = i % 3 === 2 ? {} : []; for (var j = 0; j < i % 5; j++) rows[i % 3 === 2 ? 'k' + j : j] = { name: 'it<' + i + j, tags: j % 2 ? ['a' + i, j] : undefined, price: i * 1.5 + j / 3 }; say(i, JSON.stringify(t({ rows: rows }))); }
