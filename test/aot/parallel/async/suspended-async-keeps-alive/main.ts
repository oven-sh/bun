// A suspended async function keeps alive its parameters and the objects it reads after the await, with everything they hold.
// Alone: it measures time, memory or what is collected, and that depends on what the compiler knows about the whole executable
import "../../../fixtures/jsc-shell-functions.ts";
import "./program.ts";
