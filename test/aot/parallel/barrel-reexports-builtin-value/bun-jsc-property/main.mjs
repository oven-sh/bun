import { heapSize } from "./names.mjs";
const parsed = JSON.parse("{}");
console.log(typeof heapSize, parsed.get ?? "-");
