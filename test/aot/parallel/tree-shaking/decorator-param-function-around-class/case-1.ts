import { mark } from "./marks.ts";
export function parameterOfAMethod(this: any): void {
  class Made {
    method(@mark(this.first()) value: number) {
      return value;
    }
  }
}
export function first() {
  return "first";
}
