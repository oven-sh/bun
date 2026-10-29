// Sums of three and more operands hold a text, then a symbol, then a call: which calls have run when the TypeError is thrown. Plain Bun prints another output.
const sign = Symbol("sign");
const text = ["t"][0];
const calls = [];
function call(label) {
  calls.push(label);
  return label;
}
function show(label, run) {
  calls.length = 0;
  try {
    console.log(label, "made", run());
  } catch (error) {
    console.log(label, error.name, "calls:", calls.join() || "none");
  }
}
show("literal, symbol, call", () => "a" + sign + call("last"));
show("variable, symbol, call", () => text + sign + call("last"));
show("symbol, literal, call", () => sign + "a" + call("last"));
show("call, literal, symbol, call", () => call("first") + "a" + sign + call("last"));
show("literal, call, symbol, call", () => "a" + call("first") + sign + call("last"));
show("literal, symbol, two calls", () => "a" + sign + call("third") + call("last"));
show(
  "literal, an object that converts, symbol, call",
  () =>
    "a" +
    {
      toString() {
        call("converted");
        return "o";
      },
    } +
    sign +
    call("last"),
);
show("literal, symbol", () => "a" + sign);
show("number, symbol, call", () => 1 + sign + call("last"));
show("literal, then the sum of symbol and call", () => "a" + (sign + call("last")));
show("template", () => `a${sign}${call("last")}`);
show("template that begins with a call", () => `${call("first")}${sign}${call("last")}`);
/* Output:
literal, symbol, call TypeError calls: none
variable, symbol, call TypeError calls: none
symbol, literal, call TypeError calls: none
call, literal, symbol, call TypeError calls: first
literal, call, symbol, call TypeError calls: first
literal, symbol, two calls TypeError calls: none
literal, an object that converts, symbol, call TypeError calls: converted
literal, symbol TypeError calls: none
number, symbol, call TypeError calls: none
literal, then the sum of symbol and call TypeError calls: last
template TypeError calls: none
template that begins with a call TypeError calls: first
*/
