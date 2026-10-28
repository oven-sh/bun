// The programs that parse under a type and write while the collector runs. json-parse-*.test.ts run them under harsher collections than the other files of this folder.
const inFolder = (names: string[]) => names.map(name => "data-from-outside/json-parse-type-argument-" + name);

export const narrowRecords = inFolder(["while-the-collector-runs-1", "while-the-collector-runs-6", "while-the-collector-runs-7"]);
export const wideRecords = inFolder(["while-the-collector-runs-64", "while-the-collector-runs-65"]);
export const widestRecords = inFolder(["while-the-collector-runs-200"]);
export const learnedTables = [...inFolder(["types-parsed-once-at-module-level", "long-runs-of-undeclared-members", "many-sets-of-undeclared-keys"]), "typed-objects/json-stringify-plans-after-their-structures-died"];
export const manyUndeclaredKeys = inFolder(["first-object-has-many-undeclared-keys"]);
