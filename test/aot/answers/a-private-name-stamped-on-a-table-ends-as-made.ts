// answers: without-library
// # The base class returns what it is handed, so the private name of the class below is defined on the table: its Structure is another and the mark of its cell is gone.
// # Link followed a private name to the field of its class and never looked at the object. Now a private name that is defined or stored on what may be an instance of a built-in class ends "stays as its class has made it" for the site.
// # That word is held against the object wherever it is taken: the program would stop where it were false.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
class Keep { constructor(kept: object) { return kept; } }
class Stamp extends Keep { #mark = 1; static isOn(kept: object): boolean { return #mark in kept; } }
function count(table: Map<string, number>, word: string): number { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; for (let k = 0; k < 300; k++) table.set(word, (table.get(word) ?? 0) + work); return table.get(word)!; }
const table = new Map<string, number>();
report(count(table, "a"));
new Stamp(table);
report(count(table, "a"));
report(Stamp.isOn(table));
report("end");
declare function report(value: unknown): void;
