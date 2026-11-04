// A pattern and the record of a step of matchAll() meet in one field, and a list beside them.
// Under: --aot-testing=CheckProofsAtRunTime: the class that LinkedFunction::result, LinkedCell::proven and LinkedParameter::proven name of a site whose family holds a record that a row makes
const holder = { held: null };
function pattern() { return /a(b)/g; }
function step(text) { return text.matchAll(pattern()).next(); }
function parts(text) { return text.split(","); }
holder.held = pattern();
holder.held = step("xab");
holder.held = parts("1,2");
const alone = pattern(), list = parts("3,4,5");
console.log(alone.test("ab"), alone.lastIndex, alone instanceof RegExp, list.length, list[2], Array.isArray(holder.held), step("ab").value[1], step("q").done);
