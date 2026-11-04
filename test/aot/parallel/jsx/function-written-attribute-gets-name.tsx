// An attribute of a JSX element is a property of an object literal, so a function or a class without a name that is written as its value gets the name of the attribute.
/* @jsx h */
/* @jsxRuntime classic */
function h(_tag: string, props: Record<string, unknown>) { return props }
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }
const nameOf = (value: unknown) => JSON.stringify((value as { name: string }).name)
const element = <a onClick={() => 1} onKey={function () { return 2 }} render={class {}} named={function own() {}} /> as unknown as Record<string, unknown>
console.log(nameOf(element.onClick), nameOf(element.onKey), nameOf(element.render), nameOf(element.named))
const literal: Record<string, unknown> = { onClick: () => 1 }
console.log(nameOf(literal.onClick))
