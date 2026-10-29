// Statements import settings.json, tool.cjs and notes.toml as text. A call that names one of them and holds its type in a variable, or takes it as a parameter, gets that text, and tool.cjs does not run. Asked for JSON, it gets the parsed file.
import settingsText from "./settings.json" with { type: "text" };
import toolText from "./tool.cjs" with { type: "text" };
import { notesText } from "./hands-on-notes.mjs";

const loadSettingsAs = async type => (await import("./settings.json", { with: { type } })).default;
const textOptions = { with: { type: "text" } };

const text = await loadSettingsAs("text");
console.log(typeof text, text === settingsText, text.toUpperCase());
console.log((await loadSettingsAs("json")).port + 1);

const tool = await import("./tool.cjs", textOptions);
console.log(Object.keys(tool), tool.default === toolText);

const notes = await import("./notes.toml", textOptions);
console.log(notes.default === notesText, notes.default.length);
