// RUN(STRICT): lower
// STRICT-LABEL: function {{*}}name="look"
// STRICT: [[isObject]] = TypeTest [[holder]] testedType=object
// STRICT: Branch [[isObject]] -> taken [[onObject]](| 0), notTaken [[onBinding]](| 0)
// STRICT: [[onObject]]([[found]]):
// STRICT-NEXT: [[stillHasName]] = PropHas [[found]] key="count"
// STRICT-NEXT: Branch [[stillHasName]] -> taken [[kept]](), notTaken [[lost]]()
// STRICT: [[kept]]():
// STRICT-NEXT: = PropGet [[found]] key="count"
// STRICT: [[lost]]():
// STRICT-NEXT: [[error]] = NewRuntimeError runtimeError=UnresolvableReference name="count"
// STRICT-NEXT: Throw [[error]]

// RUN(KIND): lower
// KIND-LABEL: function {{*}}name="kind"
// KIND: [[isObject]] = TypeTest [[holder]] testedType=object
// KIND: Branch [[isObject]] -> taken [[onObject]](| 0), notTaken [[onBinding]](| 0)
// KIND: [[onObject]]([[found]]):
// KIND-NEXT: = PropGet [[found]] key="count"

// RUN(SLOPPY): lower
// SLOPPY-LABEL: function {{*}}name="peek"
// SLOPPY: [[isObject]] = TypeTest [[holder]] testedType=object
// SLOPPY: Branch [[isObject]] -> taken [[onObject]](| 0), notTaken [[onBinding]](| 0)
// SLOPPY: [[onObject]]([[found]]):
// SLOPPY-NEXT: = PropGet [[found]] key="count"

module.exports = function room(shelf) {
  with (shelf) {
    function peek() {
      return count;
    }
    return class Clerk {
      static peek = peek;
      static look() {
        return count;
      }
      static kind() {
        return typeof count;
      }
    };
  }
};
