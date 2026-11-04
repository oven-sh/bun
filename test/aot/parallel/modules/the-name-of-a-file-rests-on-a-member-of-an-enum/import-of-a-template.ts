// @ts-nocheck
enum E {
  Name = "library-of-import-of-a-template",
  Path = "./library-of-import-of-a-template.ts",
}
export const found = (await import(`./${E.Name}.ts`)).value;
