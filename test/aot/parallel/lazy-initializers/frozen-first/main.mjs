// Object.prototype is frozen before the file of the object runs: the assignment throws where it stands, so the import fails, and not the first read of the variable.
// Alone: what is put off goes by all that the executable holds

import "./harden.mjs";
try { const { read } = await import("./m.mjs"); console.log("imported"); console.log(String(read())); } catch (e) { console.log("threw", e.name + ": " + e.message); }
