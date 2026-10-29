import { mark } from "./marks.ts";
export function parameterOfAStaticMethodInAnArrow(this: any): void {
  (() => {
    class Made {
      static method(other: number, @mark(this.third()) value: number) {
        return value;
      }
    }
  })();
}
export function third() {
  return "third";
}
