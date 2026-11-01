/// <reference path="./ambient.ts" />
import widgets = require("a-module-that-only-a-declaration-of-this-test-knows");
export function one(): number {
  return 1;
}
export function widget(): widgets.Widget {
  return widgets.make();
}
