// answers: without-library
// # A word of the frame serves the next value once its value has been read for the last time in its block. A parameter of a handler is filled by a landing pad, which is written behind every block:
// # it has its word from the head of its block on, not from its first read: a value made in the handler in front of that read took the same word, and `said + sum` read the name of the error for the sum.
// # OPTIONS: testing=WritesBodiesStraight
// # RUN(STRAIGHT): compile UnitsWrittenStraight mechanisms=all
// # REQUIRES(STRAIGHT): faulting-loop-polls
// # STRAIGHT: statistic UnitsWrittenStraight 5
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 25 of 25 of 25
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function fails(at: any, n: any) { if (n === at) throw new RangeError("at " + n); return n; }
function carries(at: any) { let sum = 0; try { for (let n = 1; n < 6; n++) { sum = sum + fails(at, n); } } catch (e) { const name = (e as Error).constructor.name; const said = name + " after "; return said + sum; } return "whole " + sum; }
function carriesTwo(at: any) { let first = "f"; let second = 0; try { first = first + fails(at, 1); second = second + fails(at, 2); first = first + fails(at, 3); } catch (e) { const a = (e as Error).message; const b = a + "|"; const c = b + first; return c + "|" + second; } finally { second = second + 100; } return first + second; }
function rethrows(at: any) { let kept = 1; try { try { kept = kept + fails(at, 1); kept = kept * fails(at, 2); } catch (e) { const inner = "in " + kept; kept = kept + 10; throw new Error(inner + " " + (e as Error).message); } } catch (e) { const outer = (e as Error).message; return outer + " out " + kept; } return "none " + kept; }
for (let at = 0; at < 8; at++) { report(carries(at)); report(carriesTwo(at)); report(rethrows(at)); }
report("end");
