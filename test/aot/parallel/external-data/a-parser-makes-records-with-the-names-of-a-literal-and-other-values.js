// A literal of the program reaches unseen code, so a parser may make objects of its layout. What the parser puts under the names is of other kinds than what the program puts there.
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a layout that parsers make too
function total(result) { return result.value + result.issues; }
function describe(result) { return typeof result.value + " " + typeof result.issues + " " + Object.keys(result).join(); }
const mine = { value: 1, issues: 2 };
globalThis.kept = mine;
const texts = ['{"value":"a","issues":[1]}', '{"value":null,"issues":{"value":1,"issues":2}}', '{"issues":1,"value":2}', '{"value":1.5,"issues":-0}', '{"value":1,"issues":2,"more":3}', '{"value":1}'];
const lines = [];
lines.push(total(mine) + " " + describe(mine));
for (const text of texts) {
  const parsed = JSON.parse(text);
  lines.push(String(total(parsed)) + " " + describe(parsed));
  parsed.value = mine;
  parsed.late = true;
  delete parsed.issues;
  lines.push(describe(parsed));
}
lines.push(total(mine) + " " + describe(globalThis.kept));
console.log(lines.join("\n"));
