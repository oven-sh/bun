// `let k = "kind"; node[k]` is built as `node.kind`. Of null and undefined the read, the store and `in` throw what plain code throws, and a primitive answers out of its wrapper.
// The message of such an error quotes the text of the source, which plain Bun's transpiler may have rewritten: the class of the error is what is compared.
// Under: --aot-testing=CheckProofsAtRunTime: the field that an access under a written key goes to
"use strict";
class Item { constructor(kind) { this.kind = kind; } }
function kindOf(node) { let k = "kind"; return node[k]; }
function setKind(node, value) { let k = "kind"; node[k] = value; }
function hasKind(node) { let k = "kind"; return k in node; }
const lines = [];
function attempt(label, f) { try { lines.push(label + ": " + String(f())); } catch (error) { lines.push(label + ": " + error.constructor.name); } }
const values = [new Item("item"), null, undefined, 7, "text", true, Symbol.iterator, 10n, new Item("item again")];
for (let index = 0; index < values.length; index++) {
  const value = values[index];
  attempt("read " + index, () => kindOf(value));
  attempt("store " + index, () => setKind(value, "stored"));
  attempt("in " + index, () => hasKind(value));
}
console.log(lines.join("\n"));
