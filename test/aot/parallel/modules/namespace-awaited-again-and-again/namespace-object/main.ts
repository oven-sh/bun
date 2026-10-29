import * as ns from "./a";
let held: typeof ns | Promise<typeof ns> = ns;
for (let i = 0; i < 3; i++) held = await held;
console.log((await held).f(1));
