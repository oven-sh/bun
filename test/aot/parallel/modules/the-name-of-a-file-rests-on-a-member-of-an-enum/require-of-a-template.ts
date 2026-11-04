// @ts-nocheck
enum E {
  Name = "library-of-require-of-a-template",
  Path = "./library-of-require-of-a-template.ts",
}
export const found = require(`./${E.Name}.ts`).value;
