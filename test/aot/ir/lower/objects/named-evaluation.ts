// RUN(ARROW): lower
// ARROW: function {{*}}name="f" {{*}}kind=Arrow

// RUN(FUNCTION): lower
// FUNCTION: function {{*}}name="g" module=

// RUN(CLASS): lower
// CLASS: function {{*}}name="c" {{*}}kind=BaseConstructor

// RUN(OWN): lower
// OWN-NOT: function {{*}}name="h"
// OWN: function {{*}}name="own"
// OWN-NOT: function {{*}}name="h"

// RUN(HEADERS): lower
// HEADERS-NOT: SetFunctionName

export function create() {
  return { f: () => {}, g: function () {}, c: class {}, h: function own() {} };
}
