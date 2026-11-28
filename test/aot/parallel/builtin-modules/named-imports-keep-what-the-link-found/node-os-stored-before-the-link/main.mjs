// node:os is loaded by import.meta.require() and changed before a file with named imports of it is linked: they hold what was stored, a name that was added too.
const os = import.meta.require("node:os");
os.platform = () => "made up";
os.devNull = "!";
os.madeUp = 5;
delete os.homedir;
await import("./late.mjs");
