const h = (tag: string) => "at-end:" + tag;
declare global {
  namespace JSX {
    type Element = string;
    interface IntrinsicElements { e: {} }
  }
}
export const atEnd: string = <e />;
/** @jsxRuntime classic */ /** @jsx h */
