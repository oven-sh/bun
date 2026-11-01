// Flags: --aot-disable=InlineCalls
// Classes whose constructors have typed parameters are entered by new, by Reflect.construct, by super(..), as bound functions, through proxies and by a call, from a package without types, and no call is inlined. Each row prints the names and the places of the frames of what is thrown in a body, in a default or in the initializer of a field.
import "../frames-typed-class-entered-every-way/program.ts";
