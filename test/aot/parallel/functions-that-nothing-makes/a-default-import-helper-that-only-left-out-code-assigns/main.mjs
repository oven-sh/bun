// A helper around a require that only a function that nobody calls would assign is never made. Calls of it build and throw as in bun run.
import { __importDefault } from "./helpers.mjs";
const wrap = value => __importDefault(value).default;
for (const value of [{ __esModule: true, default: 1 }, { a: 2 }, null]) {
  try { console.log(wrap(value)); } catch (e) { console.log(e.name, typeof __importDefault); }
}
