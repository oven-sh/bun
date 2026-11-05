// Reference: bun build --compile
// @jsxImportSource ./tiny
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
console.log("only this", none);
