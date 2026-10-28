// The program may import a file under a name that the build does not know. caller.mjs runs ahead of reader.mjs, which imports it, and has it read one value of data.json.
import "./reader.mjs";
if (process.env.NAME_THAT_NOBODY_SETS) await import(process.env.NAME_THAT_NOBODY_SETS);
