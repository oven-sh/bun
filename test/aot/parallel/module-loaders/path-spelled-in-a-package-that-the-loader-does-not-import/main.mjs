// The path of a file of one package goes through the program to the loader of a package that knows nothing of the first.
import { load } from "loader";
import { name, plugin } from "parts";
const all = await load(plugin);
console.log(name, Object.keys(all).sort().join(), all.unused());
