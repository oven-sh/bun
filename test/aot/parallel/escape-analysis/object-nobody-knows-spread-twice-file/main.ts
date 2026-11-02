// One file makes a literal { a, z } that nobody reads. Another hands { z } to a function made from text and spreads what comes back twice into a new object, in a loop.
// What comes back is expected to be either literal, and the two keep "z" in slots of different kinds.
import "./a-literal-with-two-names";
import "./a-function-is-handed-to-a-name-that-nobody-declares";
import "./what-comes-back-is-spread-twice";
