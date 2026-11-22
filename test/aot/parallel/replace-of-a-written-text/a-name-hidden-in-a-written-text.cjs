// A name that a file hides from bundlers is put together by replace() of a written text and evaluated: the build knows the text, and what it names is found, or told that it is not there.
"use strict";
function hidden(text, mark, by) {
  return text.replace(mark, by);
}
let tool;
try {
  tool = eval("req#re".replace("#", "ui"));
} catch (error) {
  tool = null;
}
console.log(typeof tool, tool === require);
function fetched(name) {
  try {
    const found = eval("_quire_".replace(/^_/, "re").replace(/_$/, ""))(name);
    return found && Object.keys(found).length > 0 ? found : null;
  } catch (error) {
    return error.code === "MODULE_NOT_FOUND" || error.name === "ResolveMessage" ? "not there" : error.constructor.name;
  }
}
console.log(typeof fetched("node:path").join, fetched("node:path").sep, fetched("a-package-that-nobody-has"), fetched("./nothing-beside-this-file.cjs"));
console.log(eval("typ*of tool".replace("*", "e")), eval("1 - 2".replace("-", "+")), eval("'a-a-a'".replace(/-/g, "$&$&")), eval("x => x".replace(/x/g, "value") + " * 2")(21));
console.log("plain".replace("l", "$`"), "plain".replace(/(a)(i)/, "$2$1"), "plain".replace(/z/, "never"), "plain".replace("", "re"), "plain".replace(/$/, "ly"), "aXbX".replace(/X/gi, (match, at) => match + at));
for (const [text, mark, by] of [["re-quire", "-", ""], ["REQUIRE", /./g, letter => letter.toLowerCase()], ["none", "none", "undefined"]]) {
  let answer;
  try {
    answer = typeof eval(hidden(text, mark, by));
  } catch (error) {
    answer = error.constructor.name;
  }
  console.log(text, hidden(text, mark, by), answer);
}
try {
  eval("thr@w new RangeError('thrown')".replace("@", "o"));
} catch (error) {
  console.log(error.constructor.name, error.message);
}
