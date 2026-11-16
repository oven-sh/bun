// Sloppy code reads a legacy octal number and a legacy octal escape. No "use strict" directive, class, import, export or top-level await is around the ones here, so the build takes them as `bun <file>` does.
var out = [];
function show(label, value) { out.push(label + ": " + JSON.stringify(value)); }
function mark(...values) { return function (value) { show("in a decorator in front of a class", values); return value; }; }

show("numbers", [010, 0777, 00, 08, 09.5, 08e1, -010, 010 + 011, 010.toString()]);
show("escapes", ["\1", '\2', "a\03", "\101\102", "\08", "\00", "\377", "\400", "\4a", "\8\9", "\033[0m"]);
show("not legacy", ["\0", "a\0", "\\1", 0o10, 0.5, 0]);
show("keys", Object.keys({ "\1": 1, 012: 2, [013]: 3, ["\104"]: 4 }));
var { 014: number, "\105": letter } = { 12: "by a number", E: "by an escape" };
show("keys of a pattern", [number, letter]);
function defaults(a = 015, b = "\106") { "\107"; return [a, b]; }
show("a default and a string in the place of a directive", defaults());
show("an arrow function", (() => 016 + "\110")());
switch (15) { case 017: show("a case", "\111"); }
if (false) { show("dead code", [020, "\112"]); }

function strict() { "use strict"; return typeof this; }
show("behind a function with the directive", [strict(), 021, "\113"]);
var methods = { "\114"() { "use strict"; return typeof this; }, 022() { "use strict"; return typeof this; }, [023]() { "use strict"; return typeof this; } };
show("the names of methods with the directive", Object.keys(methods).concat(methods.L(), methods[18](), methods[19]()));
class Strict { method() { return typeof this; } }
show("behind a class", [Strict.prototype.method.call(undefined), 024, "\115"]);
var Decorated = @mark(025, "\116") class {};
show("beside class expressions", [026, class {}.name, "\117", class {}.name, 027]);
(function () { "use strict"; })(); show("behind a call of a function with the directive", [030, "\120"]);

show("a text for eval", [eval("031"), (0, eval)('"\\121"'), new Function("return 032")()]);
show("a function made of a text", [new Function("a", "return a + 033")(1), eval("(function () { return '\\122'; })")()]);
function evaluatesInStrictCode() { "use strict"; try { return eval("(function () { return 034; })")(); } catch (error) { return error.name; } }
function makesStrictFunction() { try { return new Function('"use strict"; return 035;')(); } catch (error) { return error.name; } }
show("a function made of a text that is strict code", [evaluatesInStrictCode(), makesStrictFunction()]);
show("a dependency", require("./dependency.cjs"));
show("a file that requires", require("./requires.js"));
show("a file with strings that are no directive", require("./not-a-directive.cjs"));
require("./tool");
show("a file with no extension", globalThis.legacyOctalOfTool);
Promise.all([import("./no-module-syntax.mjs"), import("./no-module-syntax.js"), import("./import-meta.js"), import("./behind-comments.js")]).then(() => {
  show("a file with the extension of a module and no module syntax", globalThis.legacyOctalOfModule);
  show("a file with no module syntax", globalThis.legacyOctalOfPlainFile);
  show("a file with import.meta", globalThis.legacyOctalBesideImportMeta);
  show("a file with JSDoc comments", globalThis.legacyOctalBehindComments);
  console.log(out.join("\n"));
});
