export const Fragment = "fragment";
export function h(tag: any, props: any, ...children: any[]) { return { tag, props, children }; }
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }
export const element = <><p title="a">text</p></>;
