// JSX with the classic runtime, selected by a pragma.
/* @jsx h */
/* @jsxFrag Fragment */
/* @jsxRuntime classic */
const Fragment = "fragment"
function h(tag: any, props: any, ...children: any[]) { return { tag: typeof tag === "function" ? tag.name : tag, props, children } }
function Box(_: any) { return null }
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }
const more = { x: 1, y: 2 }
console.log(JSON.stringify(<a />))
console.log(JSON.stringify(<a key="k" b c={1 + 1}>text {more.x} <Box {...more} z="3" /></a>))
console.log(JSON.stringify(<><b /><i>two</i></>))
function scoped(h: any) { return <p /> }
console.log(scoped((tag: string) => "inner " + tag))
