import { testPrograms } from "./each-program";

// The driver is passed to the DataSource. A driver that TypeORM requires by a computed name is
// "a computed package name resolves like the same literal name" in ../in-place-executables.test.ts.
testPrograms("typeorm", {
  typeorm_given: { forms: ["as one file"], given: ["--asset", "node_modules/sql.js/dist/sql-wasm.wasm"] },
});
