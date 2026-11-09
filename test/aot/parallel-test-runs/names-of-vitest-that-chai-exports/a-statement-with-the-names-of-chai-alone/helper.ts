import "./before.js";
import { assert, should as renamed } from "vitest";
import "./after.js";
export const value = assert() + ", " + renamed();
