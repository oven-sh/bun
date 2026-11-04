function mode(self: unknown) {
  return self === undefined ? "strict" : "sloppy";
}
function otherDirective(this: unknown) {
  "first";
  return mode(this);
}
function underAs(this: unknown) {
  "use strict" as any;
  return mode(this);
}
function underNonNull(this: unknown) {
  "use strict"!;
  return mode(this);
}
function underAngleBrackets(this: unknown) {
  <any>"use strict";
  return mode(this);
}
function underSatisfies(this: unknown) {
  "use strict" satisfies string;
  return mode(this);
}
function underAsConst(this: unknown) {
  "use strict" as const;
  return mode(this);
}
function behindAType(this: unknown) {
  type A = 1;
  "use strict";
  return [
    mode(this),
    (function (this: unknown) {
      return mode(this);
    })(),
  ].join();
}
function behindAnInterface(this: unknown) {
  interface I {}
  "use strict";
  return mode(this);
}
function behindADeclaration(this: unknown) {
  declare const x: number;
  "use strict";
  return mode(this);
}
const arrow = () => {
  "use strict" as any;
  return (function (this: unknown) {
    return mode(this);
  })();
};
console.log("in functions:", otherDirective(), underAs(), underNonNull(), underAngleBrackets(), underSatisfies(), underAsConst());
console.log("behind erased statements in functions:", behindAType(), behindAnInterface(), behindADeclaration(), arrow());
