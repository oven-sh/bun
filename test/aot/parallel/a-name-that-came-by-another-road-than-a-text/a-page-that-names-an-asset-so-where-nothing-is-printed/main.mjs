// The text stands in what a page holds: the name of one of its assets.
import page from "./index.html";
const held = page;
const pick = (holder, key) => Reflect.get(holder, key);
