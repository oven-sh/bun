import { test } from "bun:test";
let evaluated = 0;
import.meta.hot.accept();
import.meta.hot.dispose(() => { evaluated++; });
test("the calls are taken out", () => {
  console.log(String(import.meta.hot.on("event", evaluated++)), String(import.meta.hot.send("event", evaluated++)), evaluated);
  console.log(import.meta.hot ? "hot" : "cold", (import.meta.hot.data.count ??= 41), typeof import.meta.hot.data, typeof import.meta.hot?.data);
});
