// RUN: link
// CHECK-NOT: path="{{*}}/node_modules/react/jsx-dev-runtime.js"
// CHECK: module {{*}}statements-that-go-take-the-import-along.tsx" {{*}}body=[[body]] positions=
// CHECK-NOT: path="{{*}}/node_modules/react/jsx-dev-runtime.js"

const unused = <a />;
let other = <></>;
<b />;
function dead() {
  return <i />;
}
const view = () => <p />;
class Unused {
  render() {
    return [dead, view, <s />];
  }
}
type Made = ReturnType<typeof dead>;
const none: Made | null = null;
console.log(none);
