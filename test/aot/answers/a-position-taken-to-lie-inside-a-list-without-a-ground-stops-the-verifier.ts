// answers: with-library
// # An access that is taken to lie inside a list names what shows it, as one to a view does: the list and the position that it speaks of, the length, its tests; where the build verifies, the verifier holds them against the records.
// # The testing word takes every position for one that lies inside: nothing shows it, and the verifier stops the build. No run is needed.
// # OPTIONS: check=Validate testing=PositionsAreTakenToLieInside
// # DIAGNOSTIC: OpcodeNotInForm
// # RUN: walk f2 mechanisms=all
// # CHECK-NOT: code f2:Body
// # f2 = read
declare function report(value: unknown): void;
function id<T>(value: T): T { (globalThis as any).leaked = value; return (globalThis as any).leaked; }
function read(cells: number[], key: number): number { const at = key | 0; if (at < 0) return -1; return cells[at]! + 1; }
const cells = [0.5, 7.5, 2.5, 3.5];
report(read(cells, id(1)));
report(read(cells, id(9)));
report(read(cells, id(-3)));
report("end");
