// The class that nobody names extends what is no constructor: the check stays where the class stood, and the import fails as it does in Bun.
let said;
try { said = (await import("./holds.mjs")).reached; } catch (error) { said = error.name; }
console.log(`SAID ${said}`);
