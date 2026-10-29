import { mark } from "./marks.ts";
// Here `this` belongs to the method: the function around the class looks at nothing.
export function defaultValueBehindADecorator() {
  class Made {
    method(@mark("own") value: unknown = this) {
      return value === this;
    }
  }
  return new Made().method();
}
export function neverNamed() {
  return "never named";
}
