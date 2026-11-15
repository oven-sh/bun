import { __exportStar, __importStar } from "./helpers.mjs";
const from = { a: 1, get b() { return 2; } };
export function use() {
  try { const o = {}; __exportStar(from, o); console.log("star", JSON.stringify(o)); } catch (e) { console.log("star", e.name); }
  try { const o = __importStar(from); console.log("import", JSON.stringify(o), Object.keys(o).join()); } catch (e) { console.log("import", e.name); }
}
use();
console.log("kept consumer");
