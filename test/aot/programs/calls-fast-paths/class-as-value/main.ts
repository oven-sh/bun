// Counts heap cells to show what is allocated when a class is used as a value.
// Each step makes a cell for each of 30 or 60 classes, or none. A collection may still find a cell or two that only the stack names, so a count is given to the nearest ten.
import "../../jsc-shell-functions.ts";
import "./program.ts";
