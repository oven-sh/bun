const flags = {};
Object.defineProperty(flags, "steps", { get: function* () { yield 1; yield 2; } });
let said = 0; for (let i = 0; i < 300; i++) for (const step of flags.steps) said += step;
console.log(said, typeof flags.steps.next);
