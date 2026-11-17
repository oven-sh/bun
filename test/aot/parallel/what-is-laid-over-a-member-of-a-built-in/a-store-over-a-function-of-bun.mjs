try { Bun.sleepSync = function () { return typeof this.$; }; console.log("SAID", Bun.sleepSync()); } catch (error) { console.log("SAID", error.name); }
