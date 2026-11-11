// answers: without-library
// # 100,000 barrels, each with a star over the one below, by the helpers as TypeScript emits them: a chain longer than the stack. What is made for the stars of a barrel is made behind that of the barrel below, by a list and not by calls;
// # a search goes down its road in a loop. A walk that calls itself once a level ends the process.
// # f0 = the module
// # RUN(FORM): walk f0 mechanisms=all
// # FORM: = TryReExportFields
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 10 of 10 of 10
// # CHECK-NEXT: exited with 0
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) { if (k2 === undefined) k2 = k; var desc = Object.getOwnPropertyDescriptor(m, k); if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) { desc = { enumerable: true, get: function() { return m[k]; } }; } Object.defineProperty(o, k2, desc); }) : (function(o, m, k, k2) { if (k2 === undefined) k2 = k; o[k2] = m[k]; }));
var __exportStar = (this && this.__exportStar) || function(m, exports) { for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p); };
function makeBarrel(level) { return { __esModule: true, level: level }; }
let top = { first: 1, second: 2 };
for (let level = 1; level <= 100000; level++) { const barrel = makeBarrel(level); __exportStar(top, barrel); top = barrel; }
report(top.first);
report(top.missing);
report("second" in top);
report("missing" in top);
report(top.level);
top.late = "late";
report(top.late);
report(Object.keys(top).join());
report(typeof Object.getOwnPropertyDescriptor(top, "first").get);
report(top.second);
report("end");
