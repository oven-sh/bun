import { jest, test } from "bun:test";
import { f } from "./m";
const mockF = () => "mocked";
jest.mock("./m", () => ({ f: () => mockF() }));
test("b", () => { console.log("b", f()); });
