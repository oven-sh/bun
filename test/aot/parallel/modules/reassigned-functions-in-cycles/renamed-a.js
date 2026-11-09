import { seen } from "./renamed-b.js";
function h() { return "h"; }
function setH(v) { h = v; }
export { h as g, h as alsoG, setH };
console.log("renamed", seen, h());
