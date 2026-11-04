function h(tag: unknown) {
  return { via: "h", tag };
}
function F(props: any) {
  return null;
}
const o = { x: 1 };
const n = { b: "x" };
export default <a b={{ c: 1 } /* @jsxRuntime classic @jsx h */} />;
void [h, o, n, F];
