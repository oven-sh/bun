// A literal of the program reaches unseen code, so a literal of evaluated text under the same names may get its layout. The text puts other kinds of values there, other orders, fewer names and more.
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a layout that parsers make too
function total(result) { return result.value + result.issues; }
function describe(result) { return typeof result.value + " " + typeof result.issues + " " + Object.keys(result).join(); }
const mine = { value: 1, issues: 2 };
globalThis.kept = mine;
const make = new Function("which", "switch (which) { case 0: return { value: 'a', issues: [1] }; case 1: return { issues: 1, value: 2 }; case 2: return { value: 1 }; case 3: return { value: 1, issues: 2, more: 3 }; case 4: return { value: 1.5, issues: -0 }; case 5: return { value: null, issues: undefined }; default: return { value: kept, issues: kept.issues }; }");
const lines = [];
lines.push(total(mine) + " " + describe(mine));
for (let turn = 0; turn < 2; turn++) {
  for (let which = 0; which < 7; which++) {
    const made = make(which);
    lines.push(which + ": " + String(total(made)) + " " + describe(made) + " " + (make(which) === made));
    made.value = mine;
    made.late = true;
    delete made.issues;
    lines.push(describe(made));
    Object.freeze(made);
    try { made.value = 1; lines.push("stored " + (made.value === mine)); } catch (error) { lines.push(error.constructor.name); }
  }
}
lines.push(total(mine) + " " + describe(globalThis.kept));
console.log(lines.join("\n"));
