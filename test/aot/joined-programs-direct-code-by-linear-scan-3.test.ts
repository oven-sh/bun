// Every function gets its machine code from the direct code generator that allocates registers by linear scan: 250 programs an executable, each compared with what it prints when B3 makes all the code.
import { joined } from "./joined-programs";

joined(
  "direct-code-by-linear-scan",
  ["--aot-testing=GenerateAllCodeDirectly", "--aot-testing=GenerateDirectCodeByLinearScan"],
  3,
  3,
);
