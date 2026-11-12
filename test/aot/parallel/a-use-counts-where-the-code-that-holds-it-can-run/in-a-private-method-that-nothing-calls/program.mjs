import { mark } from "./quiet-box/loud.mjs";
class Used {
  #neverCalled() { return mark(); }
  say() { return "main ran"; }
}
console.log(new Used().say());
