// STATISTIC: AccessesUnknown <= 20
import library from "./library.cjs";
console.log(library.run(100), library.two(4), new library.Node4(1, 2).getStart(), library.create(3).kind);
console.log(library.run(300), Object.keys(library).join());
