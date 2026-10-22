// A typed module that is required and looked at as `any`: what is read from it is read as a binding, and is `any` all the same: what the program does with it is held to nothing, and a value that is taken for a type again is given from outside, as it was.
// IR= 0 reads PropGet|ElemGet|(Prop|Elem)Define|CallMethod|ModuleNamespace
// IR= 0 takenForItsTypeAgain ElemGet|(Prop|Elem)Define|CallMethod|ModuleNamespace
// IR= 0 calls PropGet|ElemGet|(Prop|Elem)Define|CallMethod|ModuleNamespace
import type { Root } from "./state";
import "./state";
function reads() {
  return require("./state").limit + require("./state").count + require("./state")["limit"];
}
function takenForItsTypeAgain(): string {
  const root: Root = require("./state").currentRoot();
  return root.id + ":" + ++root.owner.uses + ":" + root.notes.length;
}
function calls() {
  const { bump } = require("./state");
  bump();
  require("./state").bump();
  return require("./state").count;
}
function held() {
  const state = require("./state");
  state.bump();
  const { count, limit, describe, currentRoot } = state;
  return [count, limit, describe(currentRoot()), typeof state, Object.keys(state).length].join(" ");
}
console.log(reads(), takenForItsTypeAgain(), calls(), held());
require("./state").setRoot(JSON.parse('{"owner":{"name":"owner","uses":5},"id":"r5","notes":["j"]}'));
console.log(require("./state").describe(require("./state").currentRoot()));
const { setRoot, describe, currentRoot } = require("./state");
setRoot(JSON.parse('{"owner":{"name":"owner","uses":6},"id":"r6","notes":[]}'));
console.log(describe(currentRoot()), reads());
const given: Root = currentRoot();
console.log(given.id, given.owner.uses, given.owner.name);
