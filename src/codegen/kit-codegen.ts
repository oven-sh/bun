import { join } from 'node:path';
import { readFileSync } from 'node:fs';

// The goal is to make the bundler emit an IIFE
// with the following structure:
//
//   ((graph) => {
//     ... runtime code ...
//   })([
//     // module 1
//     (require, ...) => { ... },
//     // module 2
//     (require, ...) => { ... },
//   ]);
//
// Where the runtime code in ./runtime.ts controls loading modules, hot module
// reloading, and displaying errors in browser. To make that code easier to
// write, the `graph` is abstracted as a "global" variable instead of a
// parameter.
const kit_dir = join(import.meta.dirname, '../kit');
const runtime_source = readFileSync(join(kit_dir, 'runtime.ts'));
const combined_source = `__marker__; let graph; __marker__(graph); ${runtime_source};`;
writeFileSync(join(kit_dir, ".runtime-entry.generated.ts"), combined_source);

await Promise.all(['server', 'client'].map(async mode => {
  
}));

console.log('Done');
