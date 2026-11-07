// At the top of a file `bun run` takes a string for a directive through casts and parentheses, and it compares its value. A template is none.
// In a function a directive is a bare string at the head of the body.

// RUN(AS): link
// AS: function {{*}}name="underAs"
// AS-NOT: IsSloppy
// AS: thisType=

// RUN(NONNULL): link
// NONNULL: function {{*}}name="underNonNull"
// NONNULL-NOT: IsSloppy
// NONNULL: thisType=

// RUN(ANGLE): link
// ANGLE: function {{*}}name="underAngleBrackets"
// ANGLE-NOT: IsSloppy
// ANGLE: thisType=

// RUN(SATISFIES): link
// SATISFIES: function {{*}}name="underSatisfies"
// SATISFIES-NOT: IsSloppy
// SATISFIES: thisType=

// RUN(CONST): link
// CONST: function {{*}}name="underAsConst"
// CONST-NOT: IsSloppy
// CONST: thisType=

// RUN(PARENTHESES): link
// PARENTHESES: function {{*}}name="inParentheses"
// PARENTHESES-NOT: IsSloppy
// PARENTHESES: thisType=

// RUN(ESCAPE): link
// ESCAPE: function {{*}}name="withAnEscape"
// ESCAPE-NOT: IsSloppy
// ESCAPE: thisType=

// RUN(SECOND): link
// SECOND: function {{*}}name="behindOthers"
// SECOND-NOT: IsSloppy
// SECOND: thisType=

// RUN(TEMPLATE): link
// TEMPLATE: function {{*}}name="underATemplate"{{*}}flags=[IsSloppy

// RUN(FUNCTION): link
// FUNCTION: function {{*}}name="castInAFunction"{{*}}flags=[IsSloppy

// RUN(TYPE): link
// TYPE: function {{*}}name="typeInAFunction"{{*}}flags=[IsSloppy
// TYPE: function {{*}}name="within"{{*}}flags=[IsSloppy

// FILE: main.cjs
module.exports = [
  require("./as.cts"),
  require("./non-null.cts"),
  require("./angle-brackets.ts"),
  require("./satisfies.cts"),
  require("./as-const.cts"),
  require("./parentheses.cjs"),
  require("./escape.cjs"),
  require("./second.cts"),
  require("./template.cts"),
  require("./functions.cts"),
];

// FILE: as.cts
"use strict" as any;
export = function underAs(this: unknown) {
  return this;
};

// FILE: non-null.cts
"use strict"!;
export = function underNonNull(this: unknown) {
  return this;
};

// FILE: angle-brackets.ts
<any>"use strict";
export = function underAngleBrackets(this: unknown) {
  return this;
};

// FILE: satisfies.cts
"use strict" satisfies string;
export = function underSatisfies(this: unknown) {
  return this;
};

// FILE: as-const.cts
"use strict" as const;
export = function underAsConst(this: unknown) {
  return this;
};

// FILE: parentheses.cjs
("use strict");
module.exports = function inParentheses() {
  return this;
};

// FILE: escape.cjs
"use\x20strict";
module.exports = function withAnEscape() {
  return this;
};

// FILE: second.cts
"first" as any;
("second");
"use strict";
export = function behindOthers(this: unknown) {
  return this;
};

// FILE: template.cts
`use strict` as any;
export = function underATemplate(this: unknown) {
  return this;
};

// FILE: functions.cts
function castInAFunction(this: unknown) {
  "use strict" as any;
  return this;
}
function typeInAFunction(this: unknown) {
  type A = 1;
  "use strict";
  return [
    this,
    function within(this: unknown) {
      return this;
    },
  ];
}
export = [castInAFunction, typeInAFunction];
