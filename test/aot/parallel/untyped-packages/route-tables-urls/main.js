// An untyped package and a program of it (urls): tables of written expressions in several forms: rows, objects, arrays in fields, switches of kinds; the match is read where it was made, by loops and by names, kept for later turns and compared
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const t = new lib.Table(), urls = ['/item/1', '/item/22/edit', '/item/22/copy/name', '/tag/a', '/tag/a/b/c', '/about', '/de/about.txt', '/x', '/x-1', '/x-1-2-3-4', '/item/x', 'none', '/', '/fr/about#top', '/x-a-b#/x-c']; for (let n = 0; n < 4; n++) urls.forEach((u, i) => { const v = n === 0 ? u : n === 1 ? u.replace(/\d/g, d => 9 - d) : n === 2 ? ('http://h' + u).slice(8) : u + (i % 2 ? '' : '#' + i); say(n, i, JSON.stringify(t.find(v)), t.kept.length); }); say(t.hits.join(), t.groups().join(), t.kept.map(m => m[0] + m.length).join(' '), t.first(urls), t.first(['/item/9/copy', 'q']), t.first(['q']));
