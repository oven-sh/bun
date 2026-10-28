// A function of the language is read from its holder under a key that the compiler cannot follow, passes through hidden hands, is stored in a table of the program under another name and is called there by that name.
// The table stays with the program, or has gone into hidden hands itself before the call.
export const functions: [holder: string, member: string, operands: string][] = [
  ["Array", "from", "[[1, 2, 3]]"],
  ["Array", "of", "[1, 2]"],
  ["Object", "groupBy", "[[1, 2, 3], x => x % 2]"],
  ["Object", "fromEntries", "[[['a', 1]]]"],
  ["Object", "entries", "[{ a: 1 }]"],
  ["Promise", "allSettled", "[[1]]"],
  ["Reflect", "ownKeys", "[{ a: 1 }]"],
  ["JSON", "stringify", "[{ a: 1 }]"],
  ["Math", "hypot", "[3, 4]"],
  ["Number", "parseFloat", "['1.5']"],
  ["String", "raw", "[{ raw: ['a', 'b'] }, 1]"],
  ["Atomics", "isLockFree", "[4]"],
];

export const textOf = (holder: string, member: string, operands: string, tableLeaves: boolean) => `const hide = v => new CustomEvent("x", { detail: v }).detail;
const key = hide(${JSON.stringify(member)});
const table = { run: hide(${holder}[key]) };
${tableLeaves ? "hide(table);" : ""}
try { console.log(await table.run.call(${holder}, ...${operands})); console.log(await table.run(...${operands})); } catch (e) { console.log("THROWS", e.name, String(e.message).slice(0, 90)); }
`;
