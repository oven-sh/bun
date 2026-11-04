// @ts-nocheck
enum E {
  Name = "library-of-require-of-a-sum",
  Path = "./library-of-require-of-a-sum.ts",
}
export const found = require("./" + E.Name + ".ts").value;
