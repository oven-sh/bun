import { vi } from "vitest";
import * as modules from "./modules";
console.log(Object.keys(modules).filter(name => modules[name].test === test).join(), typeof vi);
test("v", () => {});
