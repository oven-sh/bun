let said;
try { const made = await import("./job.mjs?sharedworker"); said = typeof made.default + " " + Object.keys(made).join(); } catch (e) { said = e.name; }
console.log(said);
// The build writes the module that `bun run` loads in place of the file.
