// answers: without-library
// # 200 levels of two barrels, each with a star over both barrels below, by the helpers as TypeScript emits them: the roads from the top to a leaf double with each level, the stars do not.
// # Whoever looks for a name behind stars that wait, counts their names or lists their sources sees each star once. A walk along every road does not end: the run is stopped by its time limit.
// # f0 = the module
// # RUN(FORM): walk f0 mechanisms=all
// # FORM: = TryReExportFields
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 14 of 14 of 14
// # CHECK-NEXT: exited with 0
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) { if (k2 === undefined) k2 = k; var desc = Object.getOwnPropertyDescriptor(m, k); if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) { desc = { enumerable: true, get: function() { return m[k]; } }; } Object.defineProperty(o, k2, desc); }) : (function(o, m, k, k2) { if (k2 === undefined) k2 = k; o[k2] = m[k]; }));
var __exportStar = (this && this.__exportStar) || function(m, exports) { for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p); };
function makeBarrel(level) { return { __esModule: true, level: level }; }
let left = { first: 1, shared: "left" };
let right = { shared: "right", second: 2 };
for (let level = 1; level <= 200; level++) { const a = makeBarrel(level), b = makeBarrel(level); __exportStar(left, a); __exportStar(right, a); __exportStar(right, b); __exportStar(left, b); left = a; right = b; }
report(left.first);
report(left.second);
report(right.first);
report(left.missing);
report(left.shared);
report(right.shared);
report("missing" in right);
report("second" in right);
report(left.level);
right.late = "late";
report(right.late);
report(left.late);
report(Object.keys(left).join());
report(Object.keys(right).join());
report("end");
