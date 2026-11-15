// Reference: bun build --compile
// @jsxImportSource ./tiny
// @ts-expect-error
const unused = <a />;
let other = <></>; // @ts-expect-error
<b />;
function dead() {
  return <i />;
} // @ts-expect-error
const view = () => <p />;
class Unused {
  render() {
    return [dead, view, <s />];
  }
}
type Made = ReturnType<typeof dead>;
const none: Made | null = null;
console.log("only this", none);
