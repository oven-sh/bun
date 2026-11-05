// What is known about the parameters of a callback prop depends on who calls the callback.
/** @jsxImportSource ./minicjs */
declare global {
  namespace JSX {
    type Element = any
    interface ElementChildrenAttribute { children: {} }
    interface IntrinsicAttributes { key?: unknown }
    interface IntrinsicClassAttributes<T> { ref?: (instance: T, index: number) => string }
    interface ElementClass { render(): unknown }
    interface IntrinsicElements {
      button: { label?: string; onPress?: (code: number, at: { x: number }) => string; ref?: (element: { tag: string } | null) => string; handlers?: { onHold: (ms: number) => string } }
      list: { children: (row: { id: number }) => string }
    }
  }
  const Panel: (props: { title: string; onOpen: (id: number) => string; children?: (depth: number) => string }) => JSX.Element
}
const g = globalThis as any
g.Panel = (props: any): any => props.onOpen("open") + (props.children ? " " + props.children("deep") : "")

// The host: it calls every function it finds with what no declaration says.
function run(node: any): string {
  if (typeof node === "string") return node
  const { type, props } = node
  if (typeof type === "function") return type.prototype && type.prototype.render ? props.ref ? props.ref("instance", "zero") : run(new type(props).render()) : run(type(props))
  const out: string[] = [type]
  if (props.onPress) out.push(props.onPress("code", 7))
  if (props.ref) out.push(props.ref(42))
  if (props.handlers) out.push(props.handlers.onHold("long"))
  if (typeof props.children === "function") out.push(props.children("row"))
  return out.join(" ")
}

console.log(run(<button onPress={(code, at) => typeof code + typeof at + code + at} />))
console.log(run(<button label="b" ref={element => typeof element + element} handlers={{ onHold: ms => typeof ms + ms }} />))
console.log(run(<list>{row => typeof row + row}</list>))
console.log(run(<Panel title="t" onOpen={id => typeof id + id} />))
console.log(run(<Panel title="t" onOpen={id => typeof id}>{depth => typeof depth + depth}</Panel>))

// A component of the program.
function Row(props: { id: number; onPick: (id: number, label: string) => string; children?: (id: number) => string }) {
  return props.onPick(props.id + 1, "row") + (props.children ? " " + props.children(props.id * 2) : "")
}
console.log(run(<Row id={1} onPick={(id, label) => id + 1 + label + label.length} />))
console.log(run(<Row id={2} onPick={id => "picked " + id}>{id => "child " + (id + 1)}</Row>))
class Card { constructor(public props: { title: string }) {} render() { return "card " + this.props.title } }
console.log(run(<Card title="c" />))
console.log(run(<Card title="c" ref={(instance, index) => typeof instance + typeof index} />))

// The parameters of this callback have no written types: what the declared props of the program's component say about them is a prediction, so a call with other values gets them as they are.
const element = <Row id={3} onPick={(id, label) => typeof id + typeof label} />
try { console.log(element.props.onPick("three", 3)) } catch (e) { console.log((e as Error).constructor.name) }
export {}
