console.log("x runs");
globalThis.asked = import("./b.mjs").then(b => console.log("x has " + b.b), e => console.log("x hears " + e.name));
