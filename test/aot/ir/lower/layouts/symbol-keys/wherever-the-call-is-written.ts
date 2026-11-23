// RUN: link
// CHECK: layout {{*}}name="Written" module=[[written]] {{*}}key=symbol("kWritten")@[[written]]:1 
// CHECK: layout {{*}}name="Own" module=[[main]] {{*}}key=symbol("kOwn")@[[main]]:0 
// CHECK: function {{*}}module=[[written]] kind=Module
// CHECK: calleeName="Symbol" callNumber=0
// CHECK: calleeName="Symbol" callNumber=1
// CHECK: function {{*}}module=[[main]] kind=Module
// CHECK: calleeName="Symbol" callNumber=0

// Where the call stands in the text is no part of the key.

// FILE: main.ts
import { Written } from "./written.mjs";

  /* a comment */  const kOwn = Symbol("kOwn");

  /* a comment */  class Own {

  /* a comment */    [kOwn] = 1;

  /* a comment */  }

  /* a comment */  console.log(new Own()[kOwn], new Written().read());

// FILE: written.mjs
// @bun

  /* a comment */  const kFirst = Symbol("kFirst");

  /* a comment */  const kWritten = Symbol("kWritten");

  /* a comment */  export class Written {

  /* a comment */    [kWritten] = 2;

  /* a comment */    read() {

  /* a comment */      return this[kWritten];

  /* a comment */    }

  /* a comment */  }

  /* a comment */  console.log(kFirst);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"allowJs":true,"target":"esnext","module":"esnext","moduleResolution":"bundler","types":[],"noEmit":true},"files":[]}
