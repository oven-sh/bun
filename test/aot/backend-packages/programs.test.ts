import { testPrograms, type Program } from "./each-program";

// A package that loads a native addon or reads a file of its own is given it with --asset. Each package is built in one form, and
// each form has a package with prebuilt addons. How an asset is found in either form: ../in-place-executables.test.ts,
// ../embedded-assets.test.ts, ../native-addons.test.ts.
const withAsset = (path: string, form: NonNullable<Program["forms"]>[number]): Program => ({
  forms: [form],
  given: ["--asset", path],
});

testPrograms("programs", {
  argon2: {
    ...withAsset("node_modules/argon2/prebuilds", "in place"),
    shipsNoBuildFor: ["win32-arm64", "darwin-x64"],
    withoutExceptionValidation: true,
  },
  bcrypt: withAsset("node_modules/bcrypt/prebuilds", "as one file"),
  sharp: withAsset("node_modules/@img", "as one file"),
  sqljs: withAsset("node_modules/sql.js/dist/sql-wasm.wasm", "in place"),
});
