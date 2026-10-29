import { testPrograms } from "./each-program";

testPrograms("typeorm", {
  typeorm: {
    // A driver that is required by a computed name is found where it is an entry point.
    given: ["node_modules/sql.js/dist/sql-wasm.js", "--asset", "node_modules/sql.js/dist/sql-wasm.wasm"],
    needsTheDisk: "a driver that is required by a computed name: the name of the package is looked up on the disk",
  },
  typeorm_given: { forms: ["as one file"], given: ["--asset", "node_modules/sql.js/dist/sql-wasm.wasm"] },
});
