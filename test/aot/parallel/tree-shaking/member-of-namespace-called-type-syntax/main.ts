// `(lib.start as any)()` is `lib.start()` once the types are gone, so `this` is the namespace object there too. One file per way of writing the call; in each, start reaches another export only through `this`.
import * as viaAs from "./via-as";
import * as viaAngle from "./via-angle";
import * as viaSatisfies from "./via-satisfies";
import * as viaNonNull from "./via-non-null";
import * as viaParentheses from "./via-parentheses";
import * as viaOptionalCall from "./via-optional-call";
import * as viaOptionalMember from "./via-optional-member";
import * as viaBrackets from "./via-brackets";
import * as viaTag from "./via-tag";
import * as viaCastObject from "./via-cast-object";
import * as viaNested from "./via-nested";

console.log((viaAs.start as any)());
console.log((<any>viaAngle.start)());
console.log((viaSatisfies.start satisfies Function)());
console.log(viaNonNull.start!());
console.log((viaParentheses.start)());
console.log(viaOptionalCall.start?.());
console.log(viaOptionalMember?.start());
console.log(viaBrackets["start"]());
console.log((viaTag.start as any)`x`);
console.log((viaCastObject as any).start());
console.log((((viaNested.start as any)!) as Function)());
