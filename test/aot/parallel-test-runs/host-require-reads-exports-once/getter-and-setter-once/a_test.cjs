const { test } = require("bun:test");
test("t", () => {
require("./piece.cjs");
});
function keepInProgram() { return [require("./a.cjs"), require("./b.cjs")]; }
