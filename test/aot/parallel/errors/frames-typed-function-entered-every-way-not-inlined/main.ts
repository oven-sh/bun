// Flags: --aot-disable=InlineCalls
// Typed functions are entered by a call, by new, by Reflect.construct, by super(..), as bound functions and through proxies, from a package without types, and no call is inlined. Each row prints the names and the places of the frames of what is thrown in a body or in a default.
import "../frames-typed-function-entered-every-way/program.ts";
