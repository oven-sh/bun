// The declaration file of ./values.js says that the values of a form are texts. One of them is a file.
import { pairsOf, textsOf } from "./values.js";
const form = new FormData();
form.append("a", new File(["x"], "x.txt"));
form.append("b", "text");
for (const value of textsOf(form)) { try { console.log(value.toUpperCase()); } catch (error) { console.log((error as Error).constructor.name); } }
for (const [key, value] of pairsOf(form)) console.log(key, typeof value, value.length);
function shout(text: string): string { return text + "!"; }
for (const value of textsOf(form)) console.log(typeof shout(value), String(shout(value)).length > 1);
