// A closure retains the variables it can reach and not the other captured variables of their scope: what only a short-lived closure referred to is collected while a long-lived closure of the same scope stays alive.
// Four rows say what plain Bun says too: "both are stored to", "stored to by a helper that is only called", "three sets of closures", "a callback of an array method". There a variable that is
// stored to lies in the one environment of its scope, and the closure that stays holds that environment. A compiler that gives the variables of each set of closures an environment of their
// own would collect them: the stored output may get better one day.
// The three rows of helpers across an await or a yield say what plain Bun says as well: the suspended function holds the helpers it calls again, with what they refer to.
import "../../../fixtures/jsc-shell-functions.ts";
import "./program.ts";
/* Output:
nothing is stored to: collected, 120
a counter beside it: collected, 136
more than four variables: collected, 576
both are stored to: 16 of 32, 136
stored to before the closures are made: collected, 38
stored to by a helper that is only called: kept, 136
a timer: collected, 0
a listener: collected, 0
in a loop: collected, 288
in a block: collected, 136
a closure in a closure: collected, 136
a parameter: collected, 136
a caught error: collected, 152
three sets of closures: kept, 152
across an await: collected, 288
made after an await: collected, 288
helpers that are only called, across an await: kept, 136
helpers that are only called, across a yield: kept, 136
forty variables: collected, 4800
a callback of an array method: 16 of 48, 136
methods of one object: collected, 136
a callback that counts before an await: collected, 1192
an executor before an await: collected, 632
an async arrow called at once: collected, 632
helpers that call each other, across an await: kept, 152
read by the closure that stays: kept, 648
12848
*/
