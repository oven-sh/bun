import { fail } from "./fail.mjs";
const atTop = 1 + { valueOf: () => fail() };
