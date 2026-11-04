function h(tag: unknown) {
  return { via: "h", tag };
}
function never() {
  return <a /* @jsxRuntime classic @jsx h */ />;
}
export default <a />;
void [h, never];
