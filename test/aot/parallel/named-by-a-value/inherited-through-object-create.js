const base = { get area() { return 7; }, side() { return 3; } };
const made = Object.create(base); console.log(JSON.stringify(made, ["area"]), Reflect.get(made, "side")());
