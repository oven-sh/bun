// answers: with-library
// # An access that is taken to lie inside its view names what shows it: its tests, the length, the counter and its start; where the build verifies, the verifier does the arithmetic again.
// # The testing word takes every position for one that lies inside: nothing shows it, and the verifier stops the build. No run is needed.
// # OPTIONS: check=Validate testing=AssumeIndexesInBounds
// # DIAGNOSTIC: OpcodeNotInForm
// # RUN: walk f2 mechanisms=all
// # CHECK-NOT: code f2:Body
// # f2 = read
declare function report(value: unknown): void;
function id<T>(value: T): T { (globalThis as any).leaked = value; return (globalThis as any).leaked; }
function read(cells: Int32Array, key: number): number { const at = key | 0; if (at < 0) return -1; return cells[at]! + 1; }
const cells = new Int32Array(4);
cells[1] = 7;
report(read(cells, id(1)));
report(read(cells, id(9)));
report(read(cells, id(-3)));
report("end");
