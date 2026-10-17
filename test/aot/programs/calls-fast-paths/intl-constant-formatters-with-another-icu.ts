// An executable may run with another ICU than the one that made its format patterns: macOS has the system's ICU, and an executable
// for macOS can be built on Linux. Then each pattern is planned again at its first use, from the ICU that runs. Here an option says
// that the ICU is another one, and every program about constant formatters prints what it prints in plain Bun.
import "./intl-constant-formatters";
import "./intl-constant-formatters-in-every-flow";
import "./intl-constant-formatters-known-traps";
import "./to-locale-string-with-constant-arguments";

declare const aotOperationCount: undefined | ((name: string) => number);
const isCounted = typeof aotOperationCount === "function";
const count = (what: string): number => (isCounted ? aotOperationCount!(what) : 0);
console.log("patterns are planned again:", !isCounted || count("a format pattern is planned again") > 100);
console.log("none of them is refused:", count("a format pattern is refused when planned again") === 0);
console.log("texts are written from them:", !isCounted || count("a text is written from a format pattern") > 10_000);
