// A file without `import` and `export` is a module too: `await (` in a computed name at its top level is the operator.
const keyed = { [await (async () => "a")()]: 1, [(await (async (text: string) => text)("b"))]: 2 };
console.log(JSON.stringify(keyed));
