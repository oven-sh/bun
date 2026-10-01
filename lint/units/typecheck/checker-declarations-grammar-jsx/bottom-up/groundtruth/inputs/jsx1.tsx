declare namespace JSX { interface Element { e: 1 } interface IntrinsicElements { div: { id?: string }; } }
declare const h: { create(tag: any, props: any, ...children: any[]): JSX.Element };
declare function Comp(props: { n: number }): JSX.Element;
const a = <div id={1} />;
const b = <Comp n="x" />;
const c = <span />;
const d = <><div /></>;
const e = <div id="a" id="b" />;
