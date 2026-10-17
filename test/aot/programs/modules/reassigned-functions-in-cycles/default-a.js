import { seen } from "./default-b.js";
export default function h() { return "h"; }
export function setH(v) { h = v; }
console.log("default", seen, h());
