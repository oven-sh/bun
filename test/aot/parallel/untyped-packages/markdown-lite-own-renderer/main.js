// An untyped package and a program of it (own renderer): blocks by a chain of expressions eating the text from its start; spans by one sticky expression; a renderer class with methods that may be overridden
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var calls = [];
function Mine() { lib.Renderer.apply(this, arguments); this.ids = {}; }
require('util').inherits(Mine, lib.Renderer);
Mine.prototype.heading = function (t, l) { var id = t.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\w]+/g, '-'); this.ids[id] = (this.ids[id] || 0) + 1; if (this.ids[id] > 1) id += '-' + this.ids[id]; calls.push(id); return Mine.super_.prototype.heading.call(this, '<a id="' + id + '">' + t + '</a>', l); };
Mine.prototype.link = function (h) { calls.push(h); if (/^javascript:/.test(h)) return ''; return lib.Renderer.prototype.link.apply(this, arguments); };
var r = new Mine({ gfm: true }), p = new lib.Parser({ renderer: r });
for (var i = 0; i < 14; i++) { if (i === 7) r.paragraph = function (t) { return '[' + t + ']'; }; if (i === 10) delete r.paragraph; if (i === 12) Mine.prototype.code = function (t, l) { return l + t.length; }; say(i, JSON.stringify(p.render('## Head ' + i % 4 + ' *x*\n\ntext [l' + i + '](' + (i % 3 ? 'u' + i : 'javascript:0') + ')\n\n```' + (i % 2 ? 'js' : '') + '\ncode ' + i + '\n```\n')), calls.splice(0).join()); }
