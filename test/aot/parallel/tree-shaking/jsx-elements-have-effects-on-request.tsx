// With --jsx-side-effects an element that nothing reads is still made. The command line passes the flag on only beside another --jsx option.
// Flags: --jsx-side-effects --jsx-runtime classic --jsx-factory h
// Reference: bun build --compile
/* @jsx h */
/* @jsxRuntime classic */
function h(tag: any, props: any, ...children: any[]) {
  console.log("made", typeof tag == "string" ? tag : tag.name, JSON.stringify(props), children.length);
  return { tag, props, children };
}
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }
function Part() {
  return null;
}
const unread = <p title="in a constant" />;
let alsoUnread = <Part />;
<div>in a statement</div>;
const nested = [<b />, { inner: <i>text</i> }];
export {};
console.log("end");
