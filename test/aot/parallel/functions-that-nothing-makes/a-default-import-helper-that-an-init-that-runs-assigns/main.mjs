// The helper is undefined in front of the call that assigns it, and the published one behind it.
import { __importDefault, init } from "./helpers.mjs";
const wrap = value => __importDefault(value).default;
try { console.log(wrap({ a: 1 })); } catch (e) { console.log(e.name, typeof __importDefault); }
init();
console.log(wrap({ a: 1 }).a, wrap({ __esModule: true, default: 2 }), wrap(null));
