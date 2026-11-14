// RUN: lower
// CHECK-LABEL: function {{*}}name="open"
// CHECK: [[openTest]] = TypeTest [[opts]] testedType=function @
// CHECK-NEXT: Branch [[openTest]] -> taken [[openTaken]](| 0), notTaken [[openOther]](| 0)
// CHECK-LABEL: function {{*}}name="port"
// CHECK: [[portTest]] = TypeTest [[v]] testedType=function @
// CHECK-NEXT: Branch [[portTest]] -> taken [[portTaken]](| 0), notTaken [[portOther]](| 0)

// RUN(TAKEN): lower
// TAKEN-LABEL: function {{*}}name="port"
// TAKEN: = TypeTest [[v]] testedType=function
// TAKEN: Branch {{*}} -> taken [[taken]](| 0),
// TAKEN: [[taken]]([[function]]):
// TAKEN-NEXT: [[called]] = NarrowByTest [[v]], [[function]]
// TAKEN-NOT: = Convert
// TAKEN: = Call [[called]] calleeName="v"

// RUN(OTHER): lower
// OTHER-LABEL: function {{*}}name="open"
// OTHER: = TypeTest [[opts]] testedType=function
// OTHER: Branch {{*}}notTaken [[kept]](| 0)
// OTHER: [[kept]]([[rest]]):
// OTHER-NEXT: [[named]] = NarrowByTest [[opts]], [[rest]]
// OTHER-NEXT: Jump -> next [[after]]([[named]])
// OTHER: [[after]]([[merged]]):
// OTHER: = PropGet [[merged]] key="mode"
// OTHER-LABEL: function {{*}}name="port"
// OTHER: = TypeTest [[v]] testedType=function
// OTHER: Branch {{*}}notTaken [[other]](| 0)
// OTHER: [[other]]([[record]]):
// OTHER-NEXT: [[read]] = NarrowByTest [[v]], [[record]]
// OTHER-NOT: = Convert
// OTHER: Jump -> next [[join]]([[read]])

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
