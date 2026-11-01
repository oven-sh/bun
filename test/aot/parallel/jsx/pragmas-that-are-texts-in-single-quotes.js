// The fragment pragma is a member of a quoted text.
/** @jsxRuntime classic */ /** @jsx h */ /** @jsxFrag 'xy'.length */
function h(type, props, ...children) {
  return [type, props, children.length];
}
console.log(<>{1}</>);
