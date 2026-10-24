// Plain Bun runs a repeated attribute, a comma expression in braces and a capitalized namespace name. Only TypeScript forbids them, so `@ts-ignore` suppresses each error.
/* @jsx h */
/* @jsxRuntime classic */
function h(tag: any, props: any, ...children: any[]) { return { tag, props, children } }
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }
const shown = (element: any): void => console.log(JSON.stringify(element))
// @ts-ignore
shown(<p title="first" title="second" />)
// @ts-ignore
shown(<p>{1, 2}</p>)
// @ts-ignore
shown(<Svg:path />)
export {}
