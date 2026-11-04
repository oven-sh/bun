// A load under a name that the build cannot know reads two names of what it finds. A file that a string spells stays findable and keeps those two, and its other exports stay out of the executable.
// STATISTIC: ImageFunctionsEmitted <= 475
import { name as imported } from "./lib/plugin.mjs";
const path = process.env.PLUGIN_PATH ?? import.meta.dir + "/lib/plugin.mjs";
const { name } = await import(path);
console.log(name === imported, name, (await import(path)).version);
