// JSON.parse without a type meets objects whose names fit a literal of the program, once, twice and many times, with a collection in between: the first object of a form and the later ones answer alike to every question.
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a layout that parsers make too
function make(value, issues) { return { value, issues }; }
function describe(result) { return typeof result.value + " " + typeof result.issues + " " + Object.keys(result).join() + " " + JSON.stringify(result) + " " + (Object.getPrototypeOf(result) === Object.prototype); }
globalThis.kept = make(1, 2);
const forms = ['{"value":1,"issues":2}', '{"issues":1,"value":2}', '{"value":"a","issues":[1]}', '{"value":1}', '{"value":1,"issues":2,"more":3}', '{"value":{"value":1,"issues":2},"issues":{"value":3,"issues":4}}'];
for (const form of forms) {
  const lines = [];
  for (let i = 0; i < 6; i++) {
    const parsed = JSON.parse(form);
    lines.push(describe(parsed));
    parsed.late = i;
    delete parsed.value;
    lines.push(describe(parsed));
    if (i === 3) Bun.gc(true);
  }
  console.log(new Set(lines).size, lines[0], lines[1]);
}
console.log(describe(JSON.parse("[" + forms.join(",") + "," + forms.join(",") + "]")[7]));
console.log(describe(globalThis.kept));
