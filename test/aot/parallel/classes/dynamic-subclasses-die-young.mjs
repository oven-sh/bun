// A class that extends a value and its instances die in the first collection of young objects after their last use.
import { edenGC, fullGC, heapSize } from "bun:jsc";
class Target {
  constructor() {
    this.listeners = 1;
  }
  addListener() {}
  dispatch() {}
}
class Node extends Target {
  constructor(document, localName, nodeType) {
    super();
    this.document = document;
    this.localName = localName;
    this.nodeType = nodeType;
    this.parentNode = null;
  }
  contains() {}
  cloneNode() {}
}
class Element extends Node {
  constructor(document, localName) {
    super(document, localName, 1);
    this.classes = null;
    this.style = null;
  }
  getAttribute() {}
}
class PageElement extends Element {
  constructor(document, localName) {
    super(document, localName);
    this.owner = 1;
  }
  connected() {}
}
globalThis.__elements = new Map([["PageElement", PageElement]]);
function evaluate() {
  const Parent = globalThis.__elements.get("PageElement");
  class Below extends Parent {
    connected() {
      return 1;
    }
  }
  const made = new Below(null, "x");
  return made.nodeType + made.owner;
}
let sum = 0;
for (let i = 0; i < 100; i++) sum += evaluate();
fullGC();
const before = heapSize();
for (let i = 0; i < 4000; i++) sum += evaluate();
edenGC();
console.log(sum, heapSize() - before < 300_000 ? "died young" : "kept");
