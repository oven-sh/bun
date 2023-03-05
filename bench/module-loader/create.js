const fs = require("fs");

var count = 500;

var saveStack = process.argv.includes("--save-stack") || false;
var output = process.cwd() + "/output";
// fs.rmdirSync("output", { recursive: true });
try {
  fs.mkdirSync(output, { recursive: true });
} catch (e) {}

for (var i = 0; i < count; i++) {
  var file = output + "/file" + i + ".mjs";
  fs.writeFileSync(
    file,
    new Array(Math.trunc(i * 0.25))
      .fill("")
      .map((k, j) => `export * from "./file${j}.mjs";`)
      .join(";globalThis.exportCounter++;\n") +
      `
export * from "./file${i + 1}.mjs";
export const hello${i} = "hello${i}";
${saveStack ? `globalThis.evaluationOrder.push("${file}");` : ""}
globalThis.counter++;
`,
    "utf8",
  );
  var file2 = output + "/file" + i + ".js";

  fs.writeFileSync(
    file2,
    new Array(Math.trunc(i * 0.25))
      .fill("")
      .map((k, j) => `Object.assign(module.exports, require("./file${j}.js"));`)
      .join(";globalThis.exportCounter++;\n") +
      `
  Object.assign(module.exports, require("./file${i + 1}.js"));
module.exports.hello${i} = "hello${i}";
${saveStack ? `globalThis.evaluationOrder.push("${file2}");` : ""}
globalThis.counter++;
`,
    "utf8",
  );
}

fs.writeFileSync(
  output + `/file${count}.mjs`,
  `
    export const THE_END = true;
  ${saveStack ? `globalThis.evaluationOrder.push("${output}/file${count}.mjs");` : ""}    
`,
  "utf8",
);

fs.writeFileSync(
  output + `/file${count}.js`,
  `
      module.exports.THE_END = true;
      ${saveStack ? `globalThis.evaluationOrder.push("${output}/file${count}.js");` : ""}
      `,
  "utf8",
);

fs.writeFileSync(
  import.meta.dir + "/import.mjs",
  `${saveStack ? `globalThis.evaluationOrder = [];` : ""}
  globalThis.counter=0; globalThis.exportCounter = 0;
  console.time("import");
  const Foo = await import('${output}/file0.mjs');
  export const THE_END = Foo.THE_END;
  console.timeEnd("import");
  ${saveStack ? `console.log(globalThis.evaluationOrder.join("\\n"));` : ""}
  console.log("Loaded", globalThis.counter, "files", "totaling", new Intl.NumberFormat().format(globalThis.exportCounter), 'exports');`,
  "utf8",
);

fs.writeFileSync(
  "meta.require.mjs",
  `${saveStack ? `globalThis.evaluationOrder = [];` : ""}
  globalThis.counter=0; globalThis.exportCounter = 0;
console.time("import.meta.require");
const Foo = import.meta.require("${output}/file0.mjs");
export const THE_END = Foo.THE_END;
console.timeEnd("import.meta.require");
${saveStack ? `console.log(globalThis.evaluationOrder.join("\\n"));` : ""}
console.log("Loaded", globalThis.counter, "files", "totaling", new Intl.NumberFormat().format(globalThis.exportCounter), 'exports');`,
  "utf8",
);

fs.writeFileSync(
  "meta.require.cjs",
  `${saveStack ? `globalThis.evaluationOrder = [];` : ""}
  globalThis.counter=0; globalThis.exportCounter = 0;
  await 1;
  console.time("import.meta.require");
  const Foo = import.meta.require("${output}/file0.js");
  export const THE_END = Foo.THE_END;
  console.timeEnd("import.meta.require");
  ${saveStack ? `console.log(globalThis.evaluationOrder.join("\\n"));` : ""}
  console.log("Loaded", globalThis.counter, "files", "totaling", new Intl.NumberFormat().format(globalThis.exportCounter), 'exports');`,
  "utf8",
);

fs.writeFileSync(
  import.meta.dir + "/require.js",
  `${saveStack ? `globalThis.evaluationOrder = [];` : ""}
  globalThis.counter=0; globalThis.exportCounter = 0;
  console.time("require");
  const Foo = require("${output}/file0.js");
  module.exports.THE_END = Foo.THE_END;
  console.timeEnd("require");
  ${saveStack ? `console.log(globalThis.evaluationOrder.join("\\n"));` : ""}
  console.log("Loaded", globalThis.counter, "files", "totaling", new Intl.NumberFormat().format(globalThis.exportCounter), 'exports');
  `,
  "utf8",
);

console.log(`
Created ${count} files in ${output}

${
  saveStack
    ? "The evaluation order will be dumped to stdout"
    : "To dump the evaluation order, run: \n  bun run create.js -- --save-stack"
}

Run:

  bun ./meta.require.mjs
  bun ./meta.require.js

Run:

  bun ./import.mjs
  node ./import.mjs
  deno run -A ./import.mjs

Run:

  bun ./require.js
  node ./require.js

`);
