// A `--define` gives the tag of a JSX element a name that begins with a small letter. The tag is the binding of that name that is in scope, not an element of that name: the component is called.
// Flags: --define Shown=widget
/** @jsxRuntime classic */ /** @jsx h */
function h(tag, properties) {
  return typeof tag === "function" ? tag(properties) : `<${tag}>`;
}
function widget({ label }) {
  return `the component of the file: ${label}`;
}
console.log(<Shown label="a label" />);
