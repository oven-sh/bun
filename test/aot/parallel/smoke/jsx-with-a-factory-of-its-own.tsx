/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
type Child = string | number | Element | Child[];
interface Element {
  tag: string | Function | symbol;
  props: Record<string, unknown> | null;
  children: Child[];
}
declare global {
  namespace JSX {
    interface IntrinsicElements {
      [name: string]: Record<string, unknown>;
    }
  }
}
const Fragment = Symbol("fragment");
function h(tag: Element["tag"], props: Element["props"], ...children: Child[]): Element {
  return { tag, props, children };
}
function Item({ label }: { label: string; key?: string | number }) {
  return <li title={label}>{label}</li>;
}
const props = { id: "list", "data-x": 1 };
const tree = (
  <ul {...props} className="c">
    <Item label="one" />
    <li>
      <b>2</b> &amp; more
    </li>
    <>
      {[3, 4].map(n => (
        <Item label={String(n)} key={n} />
      ))}
    </>
  </ul>
);
console.log(tree.tag, tree.children.length, JSON.stringify(tree.props));
