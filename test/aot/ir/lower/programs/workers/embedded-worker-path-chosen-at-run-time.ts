// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesData = 2
// CHECK-LABEL: function {{*}}name="ask"

// FILE: main.ts
// One `new Worker()` gets one of two embedded files, chosen at run time.
import w1 from "./w1.ts" with { type: "file" };
import w2 from "./w2.ts" with { type: "file" };
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
for (const n of [0, 1, 0]) console.log(await ask(new Worker(n ? w1 : w2), "n" + n));

// FILE: w1.ts
declare var self: Worker;
const list: number[] = [1, 2, 3];
self.onmessage = event => {
  self.postMessage("w1 got " + event.data + " " + list.map(x => x * 2).join());
};

// FILE: w2.ts
declare var self: Worker;
const list: number[] = [1, 2, 3];
self.onmessage = event => {
  self.postMessage("w2 got " + event.data + " " + list.map(x => x * 2).join());
};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
