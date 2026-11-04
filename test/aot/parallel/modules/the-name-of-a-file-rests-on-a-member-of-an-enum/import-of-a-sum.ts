// @ts-nocheck
enum E {
  Name = "library-of-import-of-a-sum",
  Path = "./library-of-import-of-a-sum.ts",
}
export const found = (await import("./" + E.Name + ".ts")).value;
