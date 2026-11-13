// An untyped package and a program of it (helpers): templates with blocks, partials, helpers, paths, else, inverted sections, each with index and key, whitespace control
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const e = new lib(); e.helper('join', function (list, sep, o) { return list.map(x => o.fn ? o.fn(x) : x).join(sep) + (o.hash.end ?? ''); }).helper('add', (...a) => a.slice(0, -1).reduce((s, x) => s + x, 0)).helper('safe', s => ({ html: '<b>' + s + '</b>' })).helper('self', function () { return typeof this + Object.keys(this).length; }).partial('row', '({{n}}{{#if more}}{{> row more}}{{/if}}{{x}})').partial('loop', '{{> loop}}');
const ts = ['{{join list ", " end="!"}}', '{{#join list "-"}}<{{this}}>{{/join}}', '{{add 1 2.5 n}} {{add (add n 1) (add 2 3)}}', '{{safe name}}{{{safe name}}}', '{{> row x="X"}}', '{{> row o}}{{> row o x=name}}', '{{self}}', '{{> nothing}}', '{{> loop}}', '{{add "a" true null}}'];
for (let i = 0; i < 4; i++) { if (i === 2) e.partial('row', '[{{n}}]'); if (i === 3) e.helper('add', function (a, b) { return this.n * a; }); ts.forEach((t, k) => { try { say(i, k, e.render(t, { list: ['a', i, 'c<'].slice(i % 2), n: i, name: 'N&' + i, o: { n: 'on', more: { n: 'deep', more: i % 2 ? { n: 'deeper' } : null } } })); } catch (x) { say(i, k, x.name, x.message); } }); } say(e.compiled, [...e.cache.keys()].join());
