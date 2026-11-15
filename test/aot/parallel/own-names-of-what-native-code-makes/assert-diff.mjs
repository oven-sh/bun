import assert from "node:assert";
const said = [];
try { assert.deepStrictEqual({ a: 1, b: [1, 2, 3] }, { a: 1, b: [1, 2, 4] }); } catch (error) { said.push(error.name, error.code, Object.getOwnPropertyNames(error).sort().join(), error.message.split("\n").length, typeof error.generatedMessage, typeof error.actual, typeof error.expected, error.operator); }
try { assert.strictEqual("a\nb\nc", "a\nx\nc"); } catch (error) { said.push(error.message.split("\n").length, error.operator); }
console.log(said.join("\n"));
