// As intl-constant-formatters-with-another-icu.ts, but the ICU that runs gives no plan for any pattern, as when it uses a pattern
// letter that the writer does not know: ICU formats everything.
import "./intl-constant-formatters";
import "./intl-constant-formatters-in-every-flow";
import "./intl-constant-formatters-known-traps";
import "./to-locale-string-with-constant-arguments";

declare const aotOperationCount: undefined | ((name: string) => number);
const isCounted = typeof aotOperationCount === "function";
const count = (what: string): number => (isCounted ? aotOperationCount!(what) : 0);
console.log("every plan is refused:", !isCounted || count("a format pattern is refused when planned again") > 100, count("a format pattern is planned again") === 0);
console.log("texts written from a pattern:", count("a text is written from a format pattern"));
