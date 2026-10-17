export const Fragment = "<>"
export function jsxDEV(tag: string, props: { children?: string }, key?: string): string {
  const shown = typeof tag === "string" ? tag.toUpperCase() : typeof tag
  const children = typeof props.children === "string" ? props.children.length : typeof props.children
  const named = typeof key === "string" ? key.toUpperCase() : typeof key + " " + String(key)
  return [shown, Object.keys(props).join(), children, named].join(" ")
}
export namespace JSX {
  export type Element = string
  export interface IntrinsicAttributes { key?: string | number }
  export interface IntrinsicElements { [name: string]: { [name: string]: unknown } }
}
