// RUN: lower
// CHECK-LABEL: function {{*}}name="open"
// CHECK: [[openTest]] = TypeTest [[opts]] testedType=function @
// CHECK-NEXT: Branch [[openTest]] -> taken [[openTaken]](| 0), notTaken [[openOther]](| 0)
// CHECK-NOT: [[opts]]
// CHECK-LABEL: function {{*}}name="port"
// CHECK: [[portTest]] = TypeTest [[v]] testedType=function @
// CHECK-NEXT: Branch [[portTest]] -> taken [[portTaken]](| 0), notTaken [[portOther]](| 0)
// CHECK-NOT: [[v]]

// RUN(TAKEN): lower
// TAKEN-LABEL: function {{*}}name="port"
// TAKEN: Branch {{*}} -> taken [[taken]](| 0),
// TAKEN: [[taken]]([[function]]):
// TAKEN: [[callee]] = Convert [[function]] declared={type=undefined|null|f{{*}}} illTypedCause=Assertion
// TAKEN: = Call [[callee]] calleeName="v"

// RUN(OTHER): lower
// OTHER-LABEL: function {{*}}name="open"
// OTHER: Branch {{*}}notTaken [[kept]](| 0)
// OTHER: [[kept]]([[options]]):
// OTHER-NEXT: Jump -> next [[after]]([[options]])
// OTHER: [[after]]([[merged]]):
// OTHER: [[convertedMerged]] = Convert [[merged]] declared={type=undefined|null|number|string|symbol|bigint|L{{*}} flags=[IsExpected]}
// OTHER: = PropGet [[convertedMerged]] key="mode"
// OTHER-LABEL: function {{*}}name="port"
// OTHER: Branch {{*}}notTaken [[other]](| 0)
// OTHER: [[other]]([[object]]):
// OTHER: [[config]] = Convert [[object]] declared={type=undefined|null|L{{*}}} illTypedCause=Assertion
// OTHER: Jump -> next [[join]]([[config]])

// RUN(NOWHERE): lower
// NOWHERE-NOT: = TypeOf

type Lazy<T> = T | (() => T);

interface Config {
  port: number;
}

export function open(opts: any, cb: any) {
  if (typeof opts === "function") {
    cb = opts;
    opts = {};
  }
  return opts.mode;
}

export function port(v: Lazy<Config>) {
  const c = typeof v === "function" ? v() : v;
  return c.port;
}
