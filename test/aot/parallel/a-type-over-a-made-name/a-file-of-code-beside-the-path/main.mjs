// `import("./" + name, { with: { type: "json" } })` may name this very file. As JSON it can only fail: the build says nothing of that, for nobody means it, and keeps none of its text.
// A file that is named as code and holds JSON is what `bun <file>` reads there.
// Build prints: 0 x warn: JSON does not support comments
const names = JSON.parse('["table.json", "list.mjs"]');
for (const name of names) console.log(JSON.stringify((await import("./" + name, { with: { type: "json" } })).default));
