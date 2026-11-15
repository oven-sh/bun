// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 5

// FILE: main.js
// Every module is imported when its turn comes. What one of them throws is printed, and the next one is imported.
const modules = [
  () => import("./empty.js"),
  () => import("./one-function.js"),
  () => import("./with-statement.js"),
  () => import("./computed-key.js"),
];
for (const load of modules) {
  try {
    await load();
    console.log("loaded");
  } catch (error) {
    console.log(`${error.constructor.name}: ${error.message}`);
  }
}

// FILE: computed-key.js
const v69 = {
  next() {},
  [v70]() {
    const v83 = {
      next() {
        const v82 = {};
      },
    };
  },
};
const v146 = {
  [v86]() {
    const v145 = {
      next() {
        const v144 = {
          get done() {
            function f111() {}
            class C115 extends Date {
              static valueOf(a117, a118) {}
              [129](a120, a121) {}
              static [Int16Array](a123, a124, a125) {}
            }
          },
          get value() {
            const v141 = {
              set [v86](a133) {
                for (let [v134, v135] of "symbol") {
                }
              },
              toString(a138, a139, ...a140) {},
            };
          },
        };
      },
    };
  },
};
function f153() {}
BigInt64Array();
unregister[v177] = f153;

// FILE: empty.js

// FILE: one-function.js
function f4(a5, a6) {}

// FILE: with-statement.js
function F0() {
  function f3() {
    function f4() {}
  }
  function f5() {
    try {
    } catch (e7) {}
    return 1429326563;
  }
  Object.defineProperty(this, "42", { get: f5, set: f8 });
}
const v40 = {
  [Symbol]() {
    const v39 = {
      get next() {
        function f33() {}
      },
    };
  },
};
with (v40) {
}
printValue("F0", F0);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
