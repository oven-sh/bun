import { test } from "bun:test";
import whole from "./default.mjs";
import * as named from "./named.mjs";
import * as star from "./star.mjs";
import { all } from "./all.mjs";
import untyped from "./untyped.mjs";
test("a", () => console.log(JSON.stringify([whole, named, star, all, untyped]), whole === all.default));
