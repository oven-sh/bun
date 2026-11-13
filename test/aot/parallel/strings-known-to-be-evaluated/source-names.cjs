// A comment in a text says where its errors are.
const say = (...a) => console.log(...a);
const at = f => { try { f(); } catch (e) { say(e.message, e.sourceURL && e.sourceURL.replace(/.*[\/\\]/, ""), e.line, e.stack.split("\n")[1].replace(/\(?\S*[\/\\]/, "").trim()); } };
at(new Function("a", "throw new Error('one');\n//# sourceURL=one.js"));
at(new Function("a", "\nthrow new Error('two');\n//@ sourceURL=folder/two.js"));
at(eval("(function () { throw new Error('three'); })\n//# sourceURL=three.js"));
at(new Function("a", "//# sourceMappingURL=four.map\nthrow new Error('four');"));
