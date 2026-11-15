// An untyped package and a program of it (template strings): one big expression with named alternatives, states, and line counting
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const lexer = lib.compile({ main: { ws: /[ \t]+/, nl: /\n/, num: { match: /\d+(?:\.\d+)?/, value: Number }, name: /[a-z_]\w*/, open: { match: '`', push: 'lit' }, end: { match: '}', pop: true }, op: /[-+*\/=(),;]/ }, lit: { interp: { match: '${', push: 'main' }, close: { match: '`', pop: true }, text: /(?:[^`$\\]|\\.|\$(?!\{))+/ } });
const inputs = ['a = 1 + 2.5;', '`hi ${ name } and ${ 1 + `in ${x}` }!`', 'x\ny = `l1\nl2 $5 ${z}`\nw', '`open', 'a # b', '', '`${}`', '}'];
for (let n = 0; n < 5; n++) for (const t of inputs) { const out = []; try { for (const k of lexer.reset(n % 2 ? t + ' q' + n : t)) if (k.type !== 'ws') out.push(k.type + '=' + JSON.stringify(k.value) + '@' + k.line + ',' + k.col); say(n, out.join(' ')); } catch (e) { say(n, out.length, e.message, lexer.state, lexer.stack.length); } }
