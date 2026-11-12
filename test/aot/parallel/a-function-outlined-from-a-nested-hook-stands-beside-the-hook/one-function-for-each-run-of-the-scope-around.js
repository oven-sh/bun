// Flags: --react-compiler
// Reference: bun build --compile
// The function that is moved out is made once for each call of the arrow and for each turn of the loop, not once for each call of the hook.
const make = (rate) => function useHandler() { "use memo"; return () => rate; };
const handler = make(1);
const made = [];
for (const rate of [2, 3]) made.push(function useHandler() { "use memo"; return () => rate; });
console.log(handler() === handler(), make(1)() === make(1)(), made[0]() === made[0](), made[0]() === made[1](), made[0]()() + made[1]()());
