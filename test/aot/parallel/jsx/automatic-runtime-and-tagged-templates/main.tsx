// JSX with the automatic runtime, and tagged templates.
/** @jsxImportSource ./mini */
import type { Node } from "./mini/jsx-runtime"
function show(node: unknown): string {
  if (Array.isArray(node)) return node.map(show).join("")
  if (node === null || typeof node !== "object") return node === true || node === false || node == null ? "" : String(node)
  const { type, props, key } = node as Node
  if (typeof type === "function") return show(type(props))
  const attrs = Object.keys(props).filter(k => k !== "children").map(k => " " + k + "=" + JSON.stringify(props[k])).join("")
  return "<" + type + (key === undefined ? "" : " key=" + key) + attrs + ">" + show(props.children) + "</" + type + ">"
}
function Item({ label, count = 0, children }: { label: string, count?: number, children?: unknown }) { return <li data-count={count}>{label}: {children}</li> }
const rest = { id: "r", title: "t" }
const items = ["a", "b"]
console.log(show(<div className="x" hidden {...rest} id="last">
  text   with  spaces
  and lines &amp; entities &lt;&#65;&#x42;&nbsp;&copy;
  {"literal"} {1 + 1}
  <Item label="one" count={1}>inner <b>bold</b></Item>
  <Item label="two" />
  {items.map(i => <Item key={i} label={i} />)}
  <>frag<i>ment</i></>
  {}
  {/* comment */}
  {false}{null}{undefined}
  <my-element a:b="c" />
</div>))
function tag(strings: TemplateStringsArray, ...values: unknown[]): string { return strings.raw.join("|") + " / " + strings.join("|") + " / " + values.join(",") + " / " + Object.isFrozen(strings) }
const sites: TemplateStringsArray[] = []
function remember(strings: TemplateStringsArray): number { sites.push(strings); return sites.length }
for (let i = 0; i < 2; i++) remember`same site`
remember`same site`
console.log(tag`a${1}b\n${"two"}A${ { x: 1 }.x }`, tag`plain`, sites[0] === sites[1], sites[0] === sites[2], String.raw`\n${1}\t`)
const holder = { prefix: ">", t(strings: TemplateStringsArray) { return this.prefix + strings[0] } }
console.log(holder.t`member`)
