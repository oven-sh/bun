// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4
// STATISTIC: SourceFilesData = 5

// FILE: main.ts
// The import of an embedded file is read where it is written at the constructor, however it is spelled: a.ts, b.ts and c.ts are compiled.
// What comes there another way is not followed: d.ts and e.ts stay plain copies.
import * as whole from "./a.ts" with { type: "file" };
import { default as named } from "./b.ts" with { type: "file" };
import path from "./c.ts" with { type: "file" };
import kept from "./d.ts" with { type: "file" };
import stored from "./e.ts" with { type: "file" };
const held = path;
const table = new Map<string, string>([["k", kept]]);
let changed = stored;
changed = table.get("k")!;
new Worker(whole.default);
new Worker(named);
new Worker(held);
new Worker(table.get("k")!);
new Worker(changed);

// FILE: a.ts
declare var self: Worker;
self.postMessage("a");

// FILE: b.ts
declare var self: Worker;
self.postMessage("b");

// FILE: c.ts
declare var self: Worker;
self.postMessage("c");

// FILE: d.ts
declare var self: Worker;
self.postMessage("d");

// FILE: e.ts
declare var self: Worker;
self.postMessage("e");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
