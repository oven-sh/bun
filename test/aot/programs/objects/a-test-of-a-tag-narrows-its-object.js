// The same without types, with string tags, a getter in the way, a tag that changes and an object without the tag.
function make(type, value) { return { type, value } }
function visit(node, out) {
  if (node.type === "number") { node.seenAsNumber = true; out.push(node.value + 1) }
  else if (node.type === "text") { node.seenAsText = true; out.push(node.value.length) }
  else { node.seenAsOther = true; out.push(-1) }
}
const computed = { get type() { return this.flip ? "number" : "text" }, flip: false, value: "four" };
const changing = make("text", "ab");
const bare = { value: 0 };
const all = [make("number", 1), make("text", "abc"), make("list", []), computed, changing, bare];
const out = [];
for (const node of all) visit(node, out);
computed.flip = true; computed.value = 41;
changing.type = "number"; changing.value = 6;
for (const node of all) visit(node, out);
console.log(out.join(), all.map(node => Object.keys(node).join("+")).join(" "));
