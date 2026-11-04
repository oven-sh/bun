// `import.meta` is handed to a helper, which reads the folder.
import { test } from "bun:test";

const take = it => it;
test("t", () => {
  console.log(take(import.meta).dir === import.meta.dir, typeof take(import.meta).url);
});
