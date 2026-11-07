// RUN: link
// CHECK: variable {{*}}name="Box" module=[[entry]] declared={type=[[box]] flags=[IsFromCompiler]} initialization=Function function=[[box]]
// CHECK: variable {{*}}name="First" module=[[entry]] declared={type=anything|absent}
// CHECK: variable {{*}}name="Alias" module=[[entry]] declared={type=undefined|null|absent|[[alias]]
// CHECK: variable {{*}}name="Written" module=[[entry]] declared={type=undefined|null|absent|[[written]]
// CHECK: function [[box]] name="Box" module=[[entry]]

// One symbol holds all meanings of a name. Whether the type or the value is declared first, the variable goes by the value: a type of its name is no annotation.
// `First` is stored to once and has no annotation, so it is untyped. `Alias` is stored to again, so it has the checker's type of the value.

import { Box } from "./imports/box";

interface First { x: number }
const First = { x: 1 };

type Alias = { y: number };
let Alias = { y: 2 };

interface Written { z: number }
const Written: Written = { z: 3 };

function Box(this: Box, v: number) {
  this.v = v;
}

export function read() {
  Alias = { y: 4 };
  return First.x + Alias.y + Written.z + new (Box as any)(5).v;
}
