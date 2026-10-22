// A module is imported by import(), and only some members of its namespace object are ever read. What the others export is no part of the program: neither the functions, nor the classes with their members and fields, nor the variables with what is made for them.
// IR- ^function f\d+ "neverLinked" .*\{$
// IR- ^function f\d+ "helperOfNeverLinked" .*\{$
// IR- ^ .*only in the method that is never linked
// IR+ ^layout L\d+ .*\{name="neverLinkedEntry" .*isNeverAllocated=true
// IR- ^function f\d+ "neverLinkedArrow" .*\{$
// IR- ^variable (g\d+) name="neverLinkedTable" [\s\S]* = PutModuleVariable v\d+ variable=\1\b
// IR- ^variable (g\d+) name="neverLinkedArrow" [\s\S]* = PutModuleVariable v\d+ variable=\1\b
// IR+  = String string="used"
// IR+  = String string="a method that is used"
// IR+ ^layout L\d+ .*\{name="usedEntry" (?!.*isNeverAllocated=true)
const lines: string[] = [];
async function all(): Promise<void> {
    const { used, UsedClass, usedTable } = await import("./things.ts");
    lines.push(used(), new UsedClass().usedMethod(), String(usedTable.usedEntry));
    const names = require("./things.ts") as typeof import("./things.ts");
    lines.push(typeof names.used);
}
all().then(() => console.log(lines.join("\n")));
