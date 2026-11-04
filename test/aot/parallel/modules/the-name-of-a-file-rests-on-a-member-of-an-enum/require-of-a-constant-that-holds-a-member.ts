// @ts-nocheck
enum E {
  Name = "library-of-require-of-a-constant-that-holds-a-member",
  Path = "./library-of-require-of-a-constant-that-holds-a-member.ts",
}
const path = E.Path;
export const found = require(path).value;
