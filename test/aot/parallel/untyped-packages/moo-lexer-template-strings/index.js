// one big expression with named alternatives, states, and line counting
'use strict';
function compile(states) {
  const all = {};
  for (const name of Object.keys(states)) {
    const rules = Object.keys(states[name]).map(k => Object.assign({ type: k }, states[name][k] instanceof RegExp || typeof states[name][k] === 'string' ? { match: states[name][k] } : states[name][k]));
    const source = rules.map(r => '(' + (r.match instanceof RegExp ? r.match.source : r.match.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')) + ')').join('|');
    all[name] = { rules, re: new RegExp(source, 'my') };
  }
  return new Tokens(all, Object.keys(states)[0]);
}
class Tokens {
  constructor(states, start) { this.states = states; this.startState = start; this.reset(''); }
  reset(text) { this.buffer = text; this.index = 0; this.line = 1; this.col = 1; this.stack = []; this.state = this.startState; return this; }
  next() {
    if (this.index >= this.buffer.length) return undefined;
    const { re, rules } = this.states[this.state]; re.lastIndex = this.index;
    const m = re.exec(this.buffer);
    if (!m) throw new Error('invalid syntax at line ' + this.line + ' col ' + this.col + ': ' + JSON.stringify(this.buffer.slice(this.index, this.index + 6)));
    let rule; for (let i = 0; i < rules.length; i++) if (m[i + 1] !== undefined) { rule = rules[i]; break; }
    const text = m[0]; let nl = 0, last = 0;
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') { nl++; last = i + 1; }
    const token = { type: rule.type, value: rule.value ? rule.value(text) : text, text, line: this.line, col: this.col, lineBreaks: nl };
    this.index += text.length; this.line += nl; this.col = nl ? text.length - last + 1 : this.col + text.length;
    if (rule.pop) this.state = this.stack.pop(); else if (rule.push) { this.stack.push(this.state); this.state = rule.push; } else if (rule.next) this.state = rule.next;
    return token;
  }
  *[Symbol.iterator]() { let t; while ((t = this.next())) yield t; }
}
module.exports = { compile };
