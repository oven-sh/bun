// The transpiler leaves these literals out, so they stop nothing, also in the body of a function.
function statement() {
  /a**/;
  console.log("statement");
}
statement();
const arrow = () => {
  (/(/);
  console.log("arrow");
};
arrow();
class Holder {
  method() {
    void /[b-a]/u;
    console.log("method");
  }
}
new Holder().method();
function inTest() {
  /a**/ && console.log("the literal is true");
  console.log(!/a**/ ? "no" : "yes");
}
inTest();
function inList() {
  [/a**/];
  ({ a: /a**/ });
  console.log("list");
}
inList();
function inStatements() {
  if (/a**/) console.log("if");
  if ([/a**/, console.log("the rest of the test")]) console.log("if of an array");
  while (/a**/) break;
  for (; /a**/; ) break;
  const other = { b: 1 };
  ({ ...other, a: /a**/ });
  console.log("statements");
}
inStatements();
function folded() {
  console.log((/a**/, "comma"), !(/a**/ || 1), void [/a**/], ![/a**/], typeof /a**/, /a**/ ? "yes" : "no");
}
folded();
