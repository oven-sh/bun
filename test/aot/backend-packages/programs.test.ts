import { testPrograms, type Program } from "./each-program";

// A package that loads a native addon or reads a file of its own is given it with --asset, and is built in both forms.
const withAsset = (path: string): Program => ({ forms: ["in place", "as one file"], given: ["--asset", path] });

testPrograms("programs", {
  argon2: {
    ...withAsset("node_modules/argon2/prebuilds"),
    shipsNoBuildFor: ["win32-arm64", "darwin-x64"],
    withoutExceptionValidation: true,
  },
  bcrypt: withAsset("node_modules/bcrypt/prebuilds"),
  sharp: withAsset("node_modules/@img"),
  sqljs: withAsset("node_modules/sql.js/dist/sql-wasm.wasm"),
});
