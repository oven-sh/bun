console.log("runtime runs");
function make(type, props, key) {
  if (typeof type === "function") return type(props);
  return (
    "<" +
    String(type) +
    (key === undefined ? "" : " key=" + key) +
    ">" +
    [].concat(props.children ?? []).join("") +
    "</" +
    String(type) +
    ">"
  );
}
export const jsx = make,
  jsxs = make,
  jsxDEV = make;
export const Fragment = "fragment";
