// No module calls the modules that it imports: an error made while an imported module runs has that module in its stack and none of its importers.
// STATISTIC: ModulesWithoutState >= 2
import { framesOfModules } from "./middle";

console.log(framesOfModules.join(", "));
