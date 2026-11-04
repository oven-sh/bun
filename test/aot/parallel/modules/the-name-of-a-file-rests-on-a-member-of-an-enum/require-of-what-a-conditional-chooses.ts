// @ts-nocheck
enum E {
  Name = "library-of-require-of-what-a-conditional-chooses",
  Path = "./library-of-require-of-what-a-conditional-chooses.ts",
}
export const found = require(true ? E.Path : "./nothing.ts").value;
