const makers = {
  Upper: () => ({ apply(text, out) { for (const c of text) if (c >= "A" && c <= "Z") out.push(c); } }),
  Digit: () => ({ apply(text, out) { for (const c of text) if (c >= "0" && c <= "9") out.push(c); } }),
  Plain: () => function (...all) { return all.length; },
};
const rules = JSON.parse('["Upper","Digit","Plain"]').map(name => makers[name]());
function ask(rule, text, out) { rule.apply(text, out); }
function found(rule, text) { const out = []; ask(rule, text, out); return out; }
function run(text) { let said = ""; for (let i = 0; i < rules.length; i++) said += ":" + found(rules[i], text).join(""); return said; }
globalThis.handed = [run];
for (const text of JSON.parse('["aB1c2D","xyz","9Z"]')) console.log(run(text));
