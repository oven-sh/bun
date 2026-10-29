// --drop reaches a call through brackets where the brackets end the callee, or where the callee is their `.call` or `.apply`. Any other member behind brackets is a value, and a call of it runs.
// Flags: --drop=assert --drop=tools.trace
// Reference: bun build --compile
declare const assert: any;
declare const tools: any;
(globalThis as any).tools = {
  trace: Object.assign(
    () => {
      throw new Error("tools.trace was called");
    },
    { deep: (text: string) => "called: " + text },
  ),
};
let evaluated = 0;
const name: string = "equal";
assert["equal"](evaluated++, 7);
assert[`equal`](evaluated++, 7);
assert[name](evaluated++, 7);
assert[evaluated++](evaluated++);
assert[name].call(assert, evaluated++);
assert[name].apply(assert, [evaluated++]);
assert[name]?.(evaluated++);
tools["trace"]("dropped");
tools?.["trace"]("dropped");
tools["trace"].call(tools, "dropped");
tools["trace"].apply(tools, ["dropped"]);
tools.trace["deep"]("dropped");
tools.trace[name]("dropped");
console.log(evaluated);
console.log(tools["trace"].deep("a member behind brackets"), tools["trace"]["deep"]("brackets behind brackets"));
console.log(
  typeof tools["trace"].bind(tools),
  typeof tools.trace.bind(tools),
  typeof tools["trace"].call.bind(tools.trace),
);
