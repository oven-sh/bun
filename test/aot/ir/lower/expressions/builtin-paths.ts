// RUN: lower
// CHECK-LABEL: function {{*}}name="consoleLog"
// CHECK: [[consoleRead]] = PropGet {{*}}key="console" [isFreeName]
// CHECK-NEXT: [[console]] = Convert [[consoleRead]] declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: [[logRead]] = PropGet [[console]] key="log"
// CHECK-NEXT: = Convert [[logRead]] declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-LABEL: function {{*}}name="date"
// CHECK: [[dateRead]] = PropGet {{*}}key="Date" [isFreeName]
// CHECK-NEXT: = Convert [[dateRead]] declared={type=builtin(Date) flags=[IsExpected]}
// CHECK-LABEL: function {{*}}name="importMeta"
// CHECK: [[meta]] = ModuleBuiltin builtin=ImportMeta module=m
// CHECK: Return [[meta]]
// CHECK-LABEL: function {{*}}name="jsonParse"
// CHECK-NOT: key="JSON"
// CHECK: = Builtin builtin=JSON @
// CHECK: [[parseRead]] = PropGet {{*}}key="parse"
// CHECK-NEXT: = Convert [[parseRead]] declared={type=builtin(JSONParse) flags=[IsExpected]}
// CHECK-LABEL: function {{*}}name="mathMax"
// CHECK-NOT: PropGet
// CHECK: = Builtin builtin=MathMax
// CHECK-NOT: PropGet
// CHECK-LABEL: function {{*}}name="mathPi"
// CHECK-NOT: builtin=MathPI
// CHECK: = Builtin builtin=Math @
// CHECK-NOT: builtin=MathPI
// CHECK: = PropGet {{*}}key="PI"
// CHECK-NOT: builtin=MathPI
// CHECK-LABEL: function {{*}}name="mathRandom"
// CHECK: = Builtin builtin=Math @
// CHECK: [[randomRead]] = PropGet {{*}}key="random"
// CHECK-NEXT: = Convert [[randomRead]] declared={type=builtin(MathRandom) flags=[IsExpected]}
// CHECK-LABEL: function {{*}}name="objectKeys"
// CHECK-NOT: PropGet
// CHECK: = Builtin builtin=ObjectKeys
// CHECK-NOT: PropGet
// CHECK-LABEL: function {{*}}name="shadowed"
// CHECK-NOT: Builtin
// CHECK-NOT: builtin(
// CHECK: b0([[parameter]]: anything):
// CHECK-NOT: Builtin
// CHECK-NOT: builtin(
// CHECK: [[receiver]] = Convert [[parameter]] declared={type=undefined|null|number|string|symbol|bigint|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: = PropGet [[receiver]] key="max"
// CHECK-NOT: Builtin
// CHECK-NOT: builtin(
// CHECK-LABEL: function {{*}}name="symbolIterator"
// CHECK-NOT: PropGet
// CHECK: = Builtin builtin=SymbolIterator
// CHECK-NOT: PropGet

export function consoleLog() {
  return console.log;
}

export function date() {
  return Date;
}

export function importMeta(): unknown {
  return import.meta;
}

export function jsonParse() {
  return JSON.parse;
}

export function mathMax() {
  return Math.max;
}

export function mathPi() {
  return Math.PI;
}

export function mathRandom() {
  return Math.random;
}

export function objectKeys() {
  return Object.keys;
}

export function shadowed(Math: any) {
  return Math.max;
}

export function symbolIterator() {
  return Symbol.iterator;
}
