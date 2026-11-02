// A `--define` gives the tag of a JSX element the name of a component that is in scope: the component is called.
// Flags: --define Shown=Widget
/** @jsxRuntime classic */ /** @jsx h */
globalThis.Widget = "the global";
function h(tag, properties) {
  return typeof tag === "function" ? tag(properties) : `<${tag}>`;
}
function Widget({ label }) {
  return `the component of the file: ${label}`;
}
console.log(<Shown label="a label" />);
