// The text of a direct eval is one name, and the binding that the build sees under it is not the one that answers: the text of a sloppy eval has declared a variable in between,
// or a `with` statement stands around the call. And texts that are no name of a binding. All of these are evaluated.
var name = "of the file";

function declaredByAnotherText() {
  eval("var name = 'declared by a text'");
  return eval("name");
}
function declaredAroundStrictCode() {
  eval("var name = 'declared by a text around strict code'");
  return (function () {
    "use strict";
    return eval("name");
  })();
}
function declaredLater(declares) {
  const read = () => eval("name");
  const before = read();
  if (declares) eval("var name = 'declared later'");
  return before + " | " + read();
}
function insideWith() {
  const name = "the binding";
  with ({ name: "of the object" }) {
    return (function () {
      "use strict";
      return eval("name");
    })();
  }
}
function insideWithThatLacksTheName() {
  const name = "the binding";
  with ({ other: 1 }) {
    return eval("name");
  }
}
console.log(declaredByAnotherText());
console.log(declaredAroundStrictCode());
console.log(declaredLater(false), "||", declaredLater(true));
console.log(insideWith(), "|", insideWithThatLacksTheName());

function strict() {
  "use strict";
  const bound = "bound";
  const attempt = look => {
    try {
      return String(look());
    } catch (error) {
      return error.name;
    }
  };
  return [
    attempt(() => eval(" bound ")),
    attempt(() => eval("bound;")),
    attempt(() => eval("(bound)")),
    attempt(() => eval("bound + 1")),
    attempt(() => eval("notBound")),
    attempt(() => eval("undefined")),
    attempt(() => typeof eval("globalThis")),
    attempt(() => typeof eval("this")),
    attempt(() => eval("arguments").length),
    attempt(() => eval("")),
    attempt(() => eval("null")),
    attempt(() => eval("\\u0062ound")),
    attempt(() => eval("let")),
    attempt(() => eval(bound)),
  ].join(" | ");
}
console.log(strict());
