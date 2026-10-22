// A member of a `const` enum is its value wherever TypeScript names it, whichever file declares the enum, as in tsc and `bun build`. Plain `bun run` reads the object of an imported enum, so it shows what JavaScript stored there.
// The object is still there for JavaScript and for a computed key. A plain enum of another file is read from its object.
import { Kind, Name, Plain } from "./kinds.ts";
import { describe, read, readByKey } from "./reader.ts";
console.log(JSON.stringify(read()), [0, 5, 6, 21, 50].map(describe).join());
Kind.Number = 50;
Name.Left = "changed";
Plain.One = 10;
console.log(JSON.stringify(read()), [0, 5, 6, 21, 50].map(describe).join());
console.log(JSON.stringify([Kind.Number, Name.Left, Plain.One, readByKey("Number"), typeof Kind]));
