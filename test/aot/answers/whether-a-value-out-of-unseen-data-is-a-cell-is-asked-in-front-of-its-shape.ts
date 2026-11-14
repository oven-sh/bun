// answers: without-library
// # numbers, booleans and texts out of JSON.parse where objects of a class are written. Whether such a value is a cell is asked in front of the read of the word of its shape, on every target:
// # left to the read it cost a handled fault a read, a hundred times and more what the test costs, as often as whoever sends the data likes.
// # f1 = inLoop, f2 = threeFields
// # no read is marked as one that reads zero off what is no cell
// # RUN(LOOP): emit f1 mechanisms=all
// # LOOP-LABEL: unit f1:Body
// # LOOP-NOT: ReadsZeroOffNoCell
// # RUN(FIELDS): emit f2 mechanisms=all
// # FIELDS-LABEL: unit f2:Body
// # FIELDS-NOT: ReadsZeroOffNoCell
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO1: 8 of 8 of 8
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
class Coin { cents = 1; tens = 2; name = "coin"; }
const made = new Coin();
function inLoop(list: Coin[]): number { let seen = 0; for (let i = 0; i < list.length; i++) { if (list[i].cents === undefined) seen++; } return seen; }
function threeFields(coin: Coin, depth: number): number { if (depth > 0) return threeFields(coin, depth - 1); return (coin.cents === undefined ? 1 : 0) + (coin.tens === undefined ? 1 : 0) + (coin.name === undefined ? 1 : 0); }
function overAll(list: Coin[]): number { let seen = 0; for (let i = 0; i < list.length; i++) seen += threeFields(list[i], 1); return seen; }
function both(text: string): void { const list = JSON.parse(text) as Coin[]; report(text + ": " + inLoop(list) + " " + overAll(list)); }
both("[7,7,7]");
both("[7.5,-0.25]");
both("[true,false]");
both("[\"seven\",\"\"]");
both("[{\"cents\":7},{\"pence\":7},7,[7]]");
both("[]");
report(inLoop([made, new Coin()]) + " " + overAll([made]));
report("end");
