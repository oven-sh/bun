declare namespace JSX { interface Element { e: 1 } interface ElementClass { render(): any } interface ElementAttributesProperty { props: {} } interface ElementChildrenAttribute { children: {} }
  interface IntrinsicElements { div: { id?: string; children?: string }; [other: string]: any } interface IntrinsicAttributes { key?: string } }
declare namespace React { function createElement(...a: any[]): any; const Fragment: any; }
class Cls { props!: { n: number; children: [number, number] }; render() { return null; } }
declare function Fn<T>(props: { v: T; cb: (x: T) => void }): JSX.Element;
const a1 = <Cls n={1}>{1}{"x"}</Cls>;
const a2 = <Fn v={1} cb={x => x.toFixed()} />;
const a3 = <div id="a">text {1}</div>;
const a4 = <Cls n={1} children={[1, 2]}>{1}{2}</Cls>;
const a5 = <div class="x" {...{ id: 1 }} />;
const a6 = <a:b />;
const a7 = <Cls.x />;
const a8 = <div>{...[1]}</div>;
declare const Tag: "div" | "nope";
const a9 = <Tag />;
