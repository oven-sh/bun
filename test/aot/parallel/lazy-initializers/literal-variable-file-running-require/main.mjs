// A literal takes a variable of a file that is still running when a computed require starts the file of the literal.
// Entry points: ./late.mjs
import "./first.mjs";
import "./late.mjs";
