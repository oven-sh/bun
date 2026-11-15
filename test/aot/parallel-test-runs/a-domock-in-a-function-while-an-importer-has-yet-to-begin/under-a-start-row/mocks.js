import { mockPackage } from "./wrap.js";
import { who } from "mocked-commonjs-package";
mockPackage(() => ({ who: () => "mock" }));
console.log("SAID the call has returned");
export const readHelper = () => who();
