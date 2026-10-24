// The compiler takes native code about which the table of built-ins declares nothing for code that may read, call, keep and pass on what
// it is handed, and that does not store into it, delete from it, redefine, freeze or reparent it, write its contents or inherit from it.
// Every overload without a declaration, every native binding and every function of the objects that native bindings answer is called
// here with recording proxies and with real objects that are compared before and after. One that changes an operand in a way that no
// entry declares needs a declaration.
//
//   AOT_BUILTINS_FILTER=<r>  only the functions whose path matches the regular expression
//
// With a sanitizer or in a debug build the calls take eight times as long: there they come in parts, each a test file of its own (../parts.mts).
import { test } from "bun:test";
import { comesInParts, nativeContract } from "./native-contract/contract";

if (comesInParts) test.skip("aot/builtins/native-contract-in-parts has it", () => {});
else nativeContract(1, 1);
