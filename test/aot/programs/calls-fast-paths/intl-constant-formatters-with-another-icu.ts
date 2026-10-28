// An executable may run with another ICU than the one that made its format patterns: macOS has the system's ICU, and an executable
// for macOS can be built on Linux. Then each pattern is planned again at its first use, from the ICU that runs. Here an option says
// that the ICU is another one, and every program about constant formatters prints what it prints in plain Bun.
import "./intl-constant-formatters";
import "./intl-constant-formatters-in-every-flow";
import "./intl-constant-formatters-known-traps";
import "./to-locale-string-with-constant-arguments";
