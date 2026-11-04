// @ts-nocheck
enum E {
  Name = "library-of-import-of-a-member",
  Path = "./library-of-import-of-a-member.ts",
}
export const found = (await import(E.Path)).value;
