// An untyped package and a program of it (changed tables): tables of written expressions in several forms: rows, objects, arrays in fields, switches of kinds; the match is read where it was made, by loops and by names, kept for later turns and compared
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const rows = lib.TABLE.slice(0, 5); const t = new lib.Table(rows); for (let i = 0; i < 30; i++) { if (i === 8) rows.unshift([/^\/item\/(\w)(\w)?(\w)?$/, 'letters', ['p', 'q', 'r']]), t.hits.unshift(0); if (i === 14) rows[1][0].exec = function () { return ['own', String(i)]; }; if (i === 18) delete rows[1][0].exec; if (i === 22) rows[2] = [new RegExp('^/(i)tem/(\\d+)'), 'made', ['i', 'n']]; const u = ['/item/' + i, '/item/ab', '/item/' + i + '/edit', '/x-' + i % 10, '/en/about', '/tag/' + i + '/z'][i % 6]; let r; try { r = JSON.stringify(t.find(u)); } catch (e) { r = e.name; } say(i, u, r, t.hits.join(), t.groups().slice(-3).join()); }
