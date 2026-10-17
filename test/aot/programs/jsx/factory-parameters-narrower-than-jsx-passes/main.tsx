// TypeScript never checks a JSX element against the signature of jsx(): a key, a tag and props that its parameters do not allow arrive as in plain Bun.
/** @jsxImportSource ./narrow */
import { jsx } from "./narrow/jsx-runtime"
function Item(props: { label: string }): string { return "item " + props.label }
console.log(<b key={0}>x</b>)
console.log([5, 6].map((n, i) => <i key={i}>{n}</i>).join(" | "))
console.log(<b key="k">x</b>)
console.log(<b>x</b>)
console.log(<b id={1}>{7}</b>)
console.log(<b>{1}{2}</b>)
console.log(<Item key={3} label="l" />)
console.log(jsx("direct", { children: "c" }, "k"))
