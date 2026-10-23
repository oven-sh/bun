// Every function gets its machine code from the direct code generator: 250 programs an executable, each compared with what it prints when B3 makes all the code.
import { joined } from "./joined-programs";

joined("all-code-direct", ["--aot-testing=GenerateAllCodeDirectly"], 2, 3);
