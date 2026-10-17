// A module is imported by import(), and only some members of its namespace object are ever read. What the others export is no part of the program: neither the functions, nor the classes with their members and fields, nor the variables with what is made for them.
// IR- ^function \d+ "neverLinked"
// IR- "helperOfNeverLinked"
// IR- only in the method that is never linked
// IR- neverLinkedEntry
// IR- ^function \d+ "neverLinkedArrow"
// IR- ^variable \d+ "neverLinkedTable"
// IR- ^variable \d+ "neverLinkedArrow"
// IR+ ^function \d+ "used"
// IR+ usedMethod
// IR+ usedEntry
const lines: string[] = [];
async function all(): Promise<void> {
    const { used, UsedClass, usedTable } = await import("./things.ts");
    lines.push(used(), new UsedClass().usedMethod(), String(usedTable.usedEntry));
    const names = require("./things.ts") as typeof import("./things.ts");
    lines.push(typeof names.used);
}
all().then(() => console.log(lines.join("\n")));
