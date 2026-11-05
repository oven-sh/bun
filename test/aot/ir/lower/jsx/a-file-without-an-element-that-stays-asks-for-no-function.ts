// RUN: link
// CHECK: module [[function]] path="{{*}}/as-function/jsx-dev-runtime.js"
// CHECK: module {{*}}/none-of-function.tsx" {{*}}body=[[body]] positions=
// CHECK: module [[module]] path="{{*}}/as-module/jsx-dev-runtime.js"
// CHECK: module {{*}}/none-of-module.tsx" {{*}}requests=[{target=[[module]] completes=true}] positions=
// CHECK: module {{*}}/one-of-function.tsx" {{*}}requests=[{target=[[function]] completes=true}] positions=

// FILE: main.ts
import "./none-of-function";
import "./none-of-module";
import "./one-of-function";
import "./one-of-module";

// FILE: none-of-function.tsx
/** @jsxImportSource ./as-function */
// @ts-expect-error
const unused = <a />;
console.log("none");

// FILE: none-of-module.tsx
/** @jsxImportSource ./as-module */
// @ts-expect-error
const unused = <a />;
console.log("none");

// FILE: one-of-function.tsx
/** @jsxImportSource ./as-function */
// @ts-expect-error
console.log(<a />);

// FILE: one-of-module.tsx
/** @jsxImportSource ./as-module */
// @ts-expect-error
console.log(<a />);

// FILE: as-function/jsx-dev-runtime.js
exports.jsxDEV = function () {
  return null;
};

// FILE: as-module/jsx-dev-runtime.js
export function jsxDEV() {
  return null;
}
