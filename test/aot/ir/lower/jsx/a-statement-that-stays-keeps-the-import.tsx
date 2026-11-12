// RUN: link
// CHECK: module [[runtime]] path="{{*}}/node_modules/react/jsx-dev-runtime.js"
// CHECK: module {{*}}a-statement-that-stays-keeps-the-import.tsx" {{*}}requests=[{target=[[runtime]] completes=true}] positions=

function view() {
  return <a />;
}
function outer() {
  function inner() {
    return view();
  }
  return 1;
}
console.log(outer());
