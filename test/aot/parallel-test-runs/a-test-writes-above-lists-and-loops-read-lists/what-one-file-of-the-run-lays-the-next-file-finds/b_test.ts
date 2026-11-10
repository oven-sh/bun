import { test } from "bun:test";
import { byIndex, found, pastTheEnd, total } from "./app";
test("the file behind it", () => {
  const list = [1, , 3.5] as number[];
  console.log(total([1, 2, 3]), byIndex([1.5, 2]), pastTheEnd(list), found([1, 2, 3], 9));
});
