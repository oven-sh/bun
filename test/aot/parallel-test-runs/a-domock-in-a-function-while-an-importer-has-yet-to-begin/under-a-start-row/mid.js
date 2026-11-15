import { who } from "mocked-commonjs-package";
import { readHelper } from "./mocks.js";
console.log("SAID the importer begins and reads", who());
export const atBody = who();
export const via = () => who() + "/" + readHelper();
