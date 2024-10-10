import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  { files: ["internal/**/*.ts"] },
  { files: ["node/**/*.ts"] },
  { ignores: ["thirdparty"] },
  { languageOptions: { globals: globals.browser } },
  { languageOptions: { parser: tseslint.parser } },
  { rules: { "no-unused-vars": "error" } },
];
