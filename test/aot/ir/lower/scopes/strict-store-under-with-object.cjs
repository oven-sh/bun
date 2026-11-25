// RUN(STRICT): lower
// STRICT-LABEL: function {{*}}name="restock"
// STRICT: [[isObject]] = TypeTest [[holder]] testedType=object
// STRICT: Branch [[isObject]] -> taken [[onObject]](| 0), notTaken [[onBinding]](| 0)
// STRICT: [[onObject]]([[found]]):
// STRICT-NEXT: [[stillHasName]] = PropHas [[found]] key="count"
// STRICT-NEXT: Branch [[stillHasName]] -> taken [[kept]](), notTaken [[lost]]()
// STRICT: [[kept]]():
// STRICT-NEXT: PropSet [[found]], [[value]] key="count" @
// STRICT: [[lost]]():
// STRICT-NEXT: [[error]] = NewRuntimeError runtimeError=UnresolvableReference name="count"
// STRICT-NEXT: Throw [[error]]

// RUN(SLOPPY): lower
// SLOPPY-LABEL: function {{*}}name="refill"
// SLOPPY: [[isObject]] = TypeTest [[holder]] testedType=object
// SLOPPY: Branch [[isObject]] -> taken [[onObject]](| 0), notTaken [[onBinding]](| 0)
// SLOPPY: [[onObject]]([[found]]):
// SLOPPY-NEXT: = PropHas [[found]] key="count"
// SLOPPY-NEXT: PropSet [[found]], [[value]] key="count" mode=Sloppy @

module.exports = function room(shelf) {
  with (shelf) {
    function refill() {
      count = 3;
    }
    return class Clerk {
      static refill = refill;
      static restock() {
        count = 2;
      }
    };
  }
};
