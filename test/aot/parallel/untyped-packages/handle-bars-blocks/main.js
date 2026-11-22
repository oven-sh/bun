// An untyped package and a program of it (blocks): templates with blocks, partials, helpers, paths, else, inverted sections, each with index and key, whitespace control
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const e = new lib(), data = { title: 'T <1>', on: true, none: [], list: [{ n: 1, sub: ['a', 'b'] }, { n: 2, sub: [] }], o: { x: 'X', y: { z: 'Z' } }, f() { return this.title.length; }, html: '<i>', zero: 0, nil: null };
const ts = ['{{title}} {{{title}}} {{&html}}', '{{#if on}}yes{{else}}no{{/if}}{{#if none}}a{{else if zero}}b{{else}}c{{/if}}', '{{#each list}}{{@index}}:{{n}}{{#each sub}}[{{this}}{{../n}}{{@first}}]{{else}}-{{/each}} {{/each}}', '{{#each o as |v k|}}{{k}}={{v.z}}{{v}};{{/each}}', '{{#with o.y}}{{z}}{{../title}}{{@root.html}}{{/with}}', '{{#list}}{{n}}{{/list}}{{^none}}none{{/none}}{{^list}}x{{/list}}', 'a  {{~title~}}  b {{! c }}{{!-- {{x}} --}}d', '{{f}} {{missing.deep.path}} {{o.[x]}} {{zero}}{{nil}}', '{{#unless on}}u{{/unless}}', '{{#if on}}', '{{/if}}', '{{nohelper 1}}', '{{#on}}{{title}}{{/on}}', ''];
for (let n = 0; n < 3; n++) ts.forEach((t, i) => { try { say(n, i, JSON.stringify(e.render(t, n ? { ...data, on: n === 2, list: data.list.slice(n), none: n === 2 ? ['q'] : [] } : data))); } catch (x) { say(n, i, x.name, x.message); } }); say(e.compiled);
