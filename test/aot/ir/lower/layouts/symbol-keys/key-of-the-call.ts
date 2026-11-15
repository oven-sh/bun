// RUN: link
// CHECK: layout {{*}}name="Written" module=[[written]] {{*}}key=symbol("kWritten")@[[written]]:1 
// CHECK: layout {{*}}name="Own" module=[[main]] {{*}}key=symbol("kOwn")@[[main]]:0 
// CHECK: function {{*}}module=[[written]] kind=Module
// CHECK: calleeName="Symbol" callNumber=0
// CHECK: calleeName="Symbol" callNumber=1
// CHECK: function {{*}}module=[[main]] kind=Module
// CHECK: calleeName="Symbol" callNumber=0

// A field that is declared under a symbol has the key of the call that makes the symbol: the module, and which of the calls of the module it is. Also in a file that `bun build` wrote.

// FILE: main.ts
import { Written } from "./written.mjs";
const kOwn = Symbol("kOwn");
class Own {
  [kOwn] = 1;
}
console.log(new Own()[kOwn], new Written().read());

// FILE: written.mjs
// @bun
const kFirst = Symbol("kFirst");
const kWritten = Symbol("kWritten");
export class Written {
  [kWritten] = 2;
  read() {
    return this[kWritten];
  }
}
console.log(kFirst);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"allowJs":true,"target":"esnext","module":"esnext","moduleResolution":"bundler","types":[],"noEmit":true},"files":[]}
