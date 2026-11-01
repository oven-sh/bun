// The fragment pragma is a quoted text: the factory is handed that text.
/** @jsxRuntime classic */ /** @jsx h */ /** @jsxFrag "fragment" */
function h(type, props, ...children) {
  return [type, props, children.length];
}
console.log(<>{1}</>);
console.log(<></>);
console.log(
  <>
    <a />
    <>{2}</>
  </>,
);
console.log(<b>{<>{3}</>}</b>);
