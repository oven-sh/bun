let held: Promise<typeof import("./a")> | typeof import("./a") = import("./a");
for (let i = 0; i < 3; i++) held = await held;
console.log((await held).f(1));
