// reader.ts writes `Box<[[[number]]]>` out and then compares `Box<number>` with `Crate<number>`, which differ at that depth: a type that is written out is compared to its end, so the build stops, as it does where reader.ts stands alone. bystander.ts, which is checked first, makes the same type by instantiation, and that changes nothing.
// Flags: --aot-threads=1
import { convert, depth } from "./reader";
import { other } from "./bystander";
const deep = { v: [[[1]]] as [[[number]]], next: null };
console.log(depth(deep), other({ make: () => deep }), convert({ v: 1, next: null }).v);
/* Build errors:
error: TS2322: Type 'Box<number>' is not assignable to type 'Crate<number>'.
*/
