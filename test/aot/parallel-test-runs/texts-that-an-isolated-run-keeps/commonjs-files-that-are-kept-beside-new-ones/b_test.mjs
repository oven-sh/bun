import { test } from "bun:test";
import "./a.cjs";
import "./b.cjs";
import "./c.cjs";
test("statements", () => console.log(order.join()));
