// @ts-nocheck
enum E {
  Name = "library-of-import-meta-resolve-of-a-member",
  Path = "./library-of-import-meta-resolve-of-a-member.ts",
}
export const found = import.meta.resolve(E.Path).endsWith(E.Name + ".ts");
