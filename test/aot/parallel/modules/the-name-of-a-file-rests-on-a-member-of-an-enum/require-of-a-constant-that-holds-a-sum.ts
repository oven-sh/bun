// @ts-nocheck
enum E {
  Name = "library-of-require-of-a-constant-that-holds-a-sum",
  Path = "./library-of-require-of-a-constant-that-holds-a-sum.ts",
}
const path = "./" + E.Name + ".ts";
export const found = require(path).value;
