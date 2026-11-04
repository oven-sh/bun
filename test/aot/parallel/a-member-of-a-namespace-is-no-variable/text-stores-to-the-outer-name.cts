let x = "outer";
namespace N { export let x = "member"; eval("x = 'stored'"); }
console.log(x, N.x, "x" in globalThis);
