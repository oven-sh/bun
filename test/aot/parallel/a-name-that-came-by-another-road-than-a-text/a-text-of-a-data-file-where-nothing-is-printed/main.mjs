// The text stands in a data file. Nothing here asks for a promise, and the name that the text spells finds every constructor.
import words from "./words.json";
const held = words;
const pick = (holder, key) => Reflect.get(holder, key);
