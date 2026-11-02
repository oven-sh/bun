// A suspended generator or async generator holds its parameters, its receiver and the locals it reads again. It lets go of a local that it does not read again.
// Alone: it measures time, memory or what is collected, and that hangs on what the compiler knows about the whole executable
import "../../../fixtures/jsc-shell-functions.ts";
import "./program.ts";
/* Output:
generators
a local: collected, 632
a local that is dead at the second yield: collected, 632
a local that is dead on one branch: collected, 632
a local made in every round of a loop: collected, 1144
a parameter: kept, 632
a parameter that is dead at the second yield: kept, 632
a destructured parameter: kept, 632
the receiver: kept, 632
a value that was yielded: collected, 632
a local read in a try block: collected, 648
a local that is dead in the catch block: collected, 632
a local read after the yield: kept, 632
a parameter read after the yield: kept, 632
a local read in a finally block: kept, 632
a parameter read in the next round of a loop: kept, 632
async generators
a local: collected, 632
a local that is dead at the second await: collected, 632
a parameter: kept, 632
a destructured parameter: kept, 632
the receiver: kept, 632
a local read before a yield: collected, 632
the result of an earlier await: collected, 632
a local read in a try block: collected, 648
a local read after the await: kept, 632
a parameter read after the await: kept, 632
*/
