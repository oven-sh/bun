// With pending deprecations on, the first value stored into process.env that is no string, number or boolean is warned about: the listeners of the program hear of it.
// Env: BUN_OPTIONS=--pending-deprecation --no-warnings
process.on("warning", warning => console.log("listener ran:", warning.name, (warning as any).code, warning.message.slice(0, 40)));
process.env.A = "text"; process.env.B = 1 as any; process.env.C = true as any;
console.log("nothing was warned about so far");
process.env.D = undefined; process.env.E = null as any;
console.log(process.env.D, process.env.E);
