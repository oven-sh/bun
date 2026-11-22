"use strict";
const said = [];
const made = (text) => JSON.parse(text);
const deep = { n0: { n1: { n2: { n3: { n4: { n5: { n6: { n7: { n8: { n9: { n10: { n11: { n12: { n13: { n14: { n15: { n16: { n17: { n18: { n19: { n20: { n21: { n22: { n23: made('{"word":"text","kx":"other"}') } } } } } } } } } } } } } } } } } } } } } } } };
function build(source, tail) { const table = { ...source }; table["k" + tail] = 5; return table; }
function readWord(table) { return table.word; }
function readLaid(table) { return table.ky; }
function under(table, key) { return table[key]; }
const table = build(made('{"word":"text","kx":"other"}'), made('"y"'));
said.push(typeof readWord(table), String(readWord(table) + 1), String(readWord(table)).length, typeof readLaid(table), String(readLaid(table) + 1), typeof under(table, "wo" + made('"rd"')), typeof under(table, "k" + made('"x"')), Object.keys(table).join("|"));
console.log("SAID " + said.join(" "));
