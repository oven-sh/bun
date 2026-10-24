// import and export declarations at the top level. import() and import.meta are expressions and can be anywhere. So can an @import tag, which is a comment.
import "node:fs"; export {};
{ import("node:fs"); }
function f() { return import.meta; }
function f() {⏎/** @import { Stats } from "node:fs" */⏎return 1; }
