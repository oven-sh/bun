// A tail call finds that its callee is no function: the frame of the caller is listed under the name as written.
const hide = value => [value][0];
const top = error => String(error.stack).split("\n").filter(line => /^\s+at /.test(line))[0].trim().split(" ").slice(0, 2).join(" ");
function make(turn) {
  function hiddenTail(g) { return g(); }
  Object.defineProperty(hiddenTail, "name", { value: "renamedHiddenTail" });
  const hiddenHolder = { method(g) { return g(1, 2, 3, 4, 5, 6, 7, 8); } };
  Object.defineProperty(hiddenHolder.method, "name", { value: "renamedHiddenMethod" });
  hiddenTail(() => 1);
  hiddenHolder.method(() => 1);
  try { hiddenTail(hide(turn)); } catch (error) { console.log(top(error)); }
  try { hiddenHolder.method(hide(turn)); } catch (error) { console.log(top(error)); }
}
for (let turn = 0; turn < 3; turn++) make(turn);
