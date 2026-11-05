// No import leads from d.mjs back to a.mjs: it asks for it by a name that it puts together, while a.mjs waits for its imports. Plain Bun runs a.mjs there and then. The executable hands out the module as it is, as the specification has it for a module that is being evaluated and as a bundle does: `x` is in its dead zone.
// Entry points: ./a.mjs
import "./a.mjs";
/* Output:
d ReferenceError
a x of b
*/
