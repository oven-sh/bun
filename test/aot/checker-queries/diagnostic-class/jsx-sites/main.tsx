function h(tag: any, props: any, ...children: any[]) { return { tag, props, children }; }
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }
export const empty = <p title={} />;
export const repeated = <p title="first" title="second" />;
export const comma = <p>{1, 2}</p>;
export const namespaced = <Svg:path />;
