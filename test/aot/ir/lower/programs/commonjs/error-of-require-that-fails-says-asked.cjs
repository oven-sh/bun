// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS100150 2
// DIAGNOSTIC: TS100151 2
// DIAGNOSTIC: TS100152 2
// CHECK-LABEL: function {{*}}name="show"
// CHECK-LABEL: function {{*}}name="joined"

// FILE: error-of-require-that-fails-says-asked.cjs
// A `require` and a `require.resolve` that find nothing fail with errors of their own: the kind, and behind `node:` also the code and the words. It makes no difference whether the name is written or put together.
const show = (label, run) => {
  try {
    console.log(label, "answers", typeof run());
  } catch (error) {
    console.log(label, "|", error.constructor.name, "|", error.code, "|", error.importKind, "|", error.specifier, "|", String(error.message).split("\n")[0]);
  }
};
const joined = text => [text].join("");
show("require, written, a package", () => require("no-such-package"));
show("require, joined, a package", () => require(joined("no-such-package")));
show("require, written, a file", () => require("./no-such-file.js"));
show("require, joined, a file", () => require(joined("./no-such-file.js")));
show("require, written, node:", () => require("node:no-such-module"));
show("require, joined, node:", () => require(joined("node:no-such-module")));
show("resolve, written, a package", () => require.resolve("no-such-package"));
show("resolve, joined, a package", () => require.resolve(joined("no-such-package")));
show("resolve, written, a file", () => require.resolve("./no-such-file.js"));
show("resolve, joined, a file", () => require.resolve(joined("./no-such-file.js")));
show("resolve, written, node:", () => require.resolve("node:no-such-module"));
show("resolve, joined, node:", () => require.resolve(joined("node:no-such-module")));

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
