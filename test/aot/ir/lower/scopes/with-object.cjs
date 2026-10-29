// RUN(LOOKUP): lower
// LOOKUP-LABEL: function {{*}}name="f"
// LOOKUP: [[object]] = ToObject
// LOOKUP: = ScopeHasBinding [[object]] key="x"
// LOOKUP: = ScopeHasBinding [[object]] key="y"
// LOOKUP-NOT: ScopeHasBinding

// RUN(READ): lower
// READ-LABEL: function {{*}}name="f"
// READ: [[isObject]] = TypeTest [[holder]] testedType=object
// READ: Branch [[isObject]] -> taken [[onObject]](| 0), notTaken [[onBinding]](| 0)
// READ: [[onObject]]([[found]]):
// READ: = PropGet [[found]] key="y" @
// READ: [[onBinding]](
// READ: [[global]] = Builtin builtin=GlobalThis
// READ: = PropGet [[global]] key="y" [isFreeName]

// RUN(STORE): lower
// STORE-LABEL: function {{*}}name="f"
// STORE: = PropGet {{*}}key="y" @
// STORE: [[isObject]] = TypeTest [[holder]] testedType=object
// STORE: Branch [[isObject]] -> taken [[onObject]](| 0), notTaken [[onBinding]](| 0)
// STORE: [[onObject]]([[found]]):
// STORE: PropSet [[found]], [[value]] key="x" mode=Sloppy @
// STORE: [[onBinding]](
// STORE: [[global]] = Builtin builtin=GlobalThis
// STORE: PropSet [[global]], [[value]] key="x" mode=Sloppy [isFreeName]

module.exports = function f(o) {
  with (o) {
    x = y;
  }
};
