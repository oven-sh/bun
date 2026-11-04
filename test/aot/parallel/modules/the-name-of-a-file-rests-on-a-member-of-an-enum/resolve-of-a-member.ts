// @ts-nocheck
enum E {
  Name = "library-of-resolve-of-a-member",
  Path = "./library-of-resolve-of-a-member.ts",
}
export const found = require.resolve(E.Path).endsWith(E.Name + ".ts");
