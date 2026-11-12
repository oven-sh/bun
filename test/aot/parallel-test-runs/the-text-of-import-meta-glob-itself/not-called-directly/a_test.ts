import { test } from "bun:test";
// In a test run the loader lays a function under import.meta.glob for whoever does not call it directly. It has a text of its own, as under `bun test`.
const listed = import.meta.glob("./things/*.ts");
test("the text of import.meta.glob evaluated again throws as the function does", () => {
  const glob: any = import.meta.glob;
  const again = (0, eval)("(" + glob + ")");
  for (const ask of [glob, again])
    try {
      ask("./things/*.ts");
    } catch (error: any) {
      console.log(error.name + ": " + error.message);
    }
  console.log(Object.keys(listed).join());
});
