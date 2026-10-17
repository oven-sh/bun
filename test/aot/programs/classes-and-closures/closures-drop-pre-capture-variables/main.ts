// A variable whose last assignment comes before it is captured is copied into each closure that refers to it, so a closure that stays alive does not retain what only a short-lived closure of the same scope referred to.
import "../../jsc-shell-functions.ts";
import "./program.ts";
