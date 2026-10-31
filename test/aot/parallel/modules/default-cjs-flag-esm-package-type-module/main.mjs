// In a package whose package.json says "type": "module", `__esModule` on a .cjs file counts for nothing: the default of the file is its whole exports, for
// an import statement, for a module that hands the default on, and for `ns.default`. A getter of another CommonJS file still returns the member.
import direct, { version } from "./package/index.cjs";
import handedOn, { version as throughStar } from "./package/wrapper.js";
import { renamed } from "./package/renamed.js";
import * as all from "./package/index.cjs";
import * as second from "./package/second.cjs";
import { taken } from "./package/getter.cjs";
import { taken as overModule } from "./package/getter-over-the-wrapper.cjs";
import { read } from "./package/reader.cjs";

const show = value => (typeof value === "function" ? "function " + value() : typeof value + " " + Object.keys(value));
console.log(show(direct), "|", show(handedOn), "|", show(renamed), "|", version, throughStar);
console.log(show(all.default), "|", show(all.default.default), "|", show(second.default), "|", second.default.default);
console.log(show(taken), "|", show(overModule), "|", read().map(show).join(" | "));
