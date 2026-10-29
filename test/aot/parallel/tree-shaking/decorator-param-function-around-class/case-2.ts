import { mark } from "./marks.ts";
export function parameterOfAConstructor(this: any): void {
  class Made {
    constructor(@mark(this.second()) value: number) {}
  }
}
export function second() {
  return "second";
}
