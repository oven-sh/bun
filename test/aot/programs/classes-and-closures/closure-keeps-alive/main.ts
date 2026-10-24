// A closure retains the variables it can reach and not the other captured variables of their scope: what only a short-lived closure referred to is collected while a long-lived closure of the same scope stays alive.
// Four rows say what plain Bun says too: "both are stored to", "stored to by a helper that is only called", "three sets of closures", "a callback of an array method". There a variable that is
// stored to lies in the one environment of its scope, and the closure that stays holds that environment. A compiler that gives the variables of each set of closures an environment of their
// own would collect them: the stored output may get better one day.
import "../../jsc-shell-functions.ts";
import "./program.ts";
