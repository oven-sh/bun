// An untyped package and a program of it (css like): one big expression with named alternatives, states, and line counting
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const lexer = lib.compile({ top: { space: /\s+/, comment: /\/\*[^]*?\*\//, sel: /[.#]?[\w-]+/, comma: ',', lbrace: { match: '{', next: 'body' } }, body: { space: /\s+/, prop: /[a-z-]+(?=\s*:)/, colon: ':', val: { match: /[^;{}:\s][^;{}]*/, value: s => s.trim().toUpperCase() }, semi: ';', rbrace: { match: '}', next: 'top' } } });
for (let i = 0; i < 20; i++) { const css = ['.a' + i + ', #b { color: red; width : ' + i + 'px }', 'p{margin:0 auto;}\n/* c\nd */ div { x:y }', 'h' + i + '{}', '.q { a: b; c }'][i % 4]; const rules = {}; let cur, prop, sels = []; try { for (const t of lexer.reset(css)) { if (t.type === 'sel') sels.push(t.value); else if (t.type === 'lbrace') { cur = {}; for (const s of sels) rules[s] = cur; sels = []; } else if (t.type === 'prop') prop = t.value; else if (t.type === 'val') cur[prop] = t.value; } say(i, JSON.stringify(rules), lexer.line, lexer.col); } catch (e) { say(i, e.message); } }
