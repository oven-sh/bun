// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3
// STATISTIC: SourceFilesData = 1
// CHECK-LABEL: function {{*}}name="ask"

// FILE: main.ts
// The main thread and a Worker started from an embedded file import the same module; each has its own copy of the module's state.
import w1 from "./w1.ts" with { type: "file" };
function ask(w: Worker, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    w.onmessage = e => {
      resolve(String(e.data));
      w.terminate();
    };
    w.onerror = e => {
      reject(new Error("worker error: " + e.message));
    };
    w.postMessage(text);
  });
}
import { count } from "./shared.ts";
console.log(count(), await ask(new Worker(w1), "a"), count());

// FILE: shared.ts
let n = 0;
export function count() {
  return ++n;
}

// FILE: w1.ts
import { count } from "./shared.ts";
count();
count();
declare var self: Worker;
const list: number[] = [1, 2, 3];
self.onmessage = event => {
  self.postMessage("w1 " + count() + " got " + event.data + " " + list.map(x => x * 2).join());
};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
