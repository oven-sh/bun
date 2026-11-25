import file from "./note.txt" with { type: "file" };
import one from "./one.cjs";
import two from "./two.cjs";
const say = v => (typeof v === "string" ? v.trim().replace(/.*[\\/]/, "path ") : Object.keys(v).join());
console.log(say(file).startsWith("path"), say(two.text), say(two.typed), say((await one.pending).default));
