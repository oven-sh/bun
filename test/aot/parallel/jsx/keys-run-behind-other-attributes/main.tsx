// The automatic runtime takes the key behind the attributes and the children, which may be written behind it.
// @jsxImportSource ./tiny
function attribute(): unknown {
  const box: { field: unknown } = { field: {} };
  return <div key={typeof box.field} a={(box.field = 1)} b={typeof box.field} />;
}
function child(): unknown {
  const box: { field: unknown } = { field: {} };
  return <div key={box.field ? "truthy" : "falsy"}>{(box.field = 0)}</div>;
}
function keyBehind(): unknown {
  const box: { field: unknown } = { field: {} };
  return <div a={typeof box.field} key={String((box.field = 1))} b={typeof box.field} />;
}
console.log(attribute(), child(), keyBehind());
