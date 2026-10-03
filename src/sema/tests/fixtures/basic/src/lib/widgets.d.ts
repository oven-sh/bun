export = Widgets;
export as namespace Widgets;
declare namespace Widgets {
  type Node = string | number | Element;
  interface Element {
    tag: string;
  }
  function make(tag: string): Element;
}
