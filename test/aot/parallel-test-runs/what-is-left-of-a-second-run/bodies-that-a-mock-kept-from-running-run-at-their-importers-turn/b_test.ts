import "./first";
import { readOne } from "./r1";
import { readTwo } from "./r2";
import { test } from "bun:test";
test("b", () => { console.log("b", readOne(), readTwo()); });
