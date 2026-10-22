/** @jsxRuntime classic */
/** @jsx h */
declare global { namespace JSX { interface IntrinsicElements { box: { size: number } } interface Element { tag: string; props: object } } }
function h(tag: string, props: object | null): JSX.Element { return { tag, props: props ?? {} }; }
export const view = <box size={3} />;
