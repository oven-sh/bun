// `const Row = (props) => ..` and `const Cell = function (props) {..}` are named by tags alone, one of them with a closing tag.
/* @jsxRuntime classic */
/* @jsx h */
export {};
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }

const h = (tag: any, props: any, ...children: any[]): any =>
  typeof tag === "function" ? tag({ ...props, children }) : "<" + tag + ">" + children.join("") + "</" + tag + ">";

const Cell = function (props: { children?: any }) {
  return <td>{props.children}</td>;
};

const Row = (props: { cells: string[] }) => <tr>{props.cells.map(cell => <Cell>{cell}</Cell>)}</tr>;

console.log(<Row cells={["a", "b"]} />);
