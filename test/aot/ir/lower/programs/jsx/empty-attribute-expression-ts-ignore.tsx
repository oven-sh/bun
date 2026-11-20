// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS17000 1

// Plain Bun rejects `title={}` as a syntax error, so `@ts-ignore` does not suppress it in a compiled file.
/* @jsx h */
/* @jsxRuntime classic */
function h(tag: any, props: any, ...children: any[]) { return { tag, props, children } }
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }
// @ts-ignore
console.log(<p title={} />)
export {}
