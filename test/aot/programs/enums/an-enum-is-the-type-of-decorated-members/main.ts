import { Color } from "./color";
import { read } from "./reader";
const seen: any[] = [];
(Reflect as any).metadata = (key: string, value: any) => (target: any, name: string) => {
  seen.push(key, value);
};
function mark(target: any, name: string) {}
class Holder {
  @mark color: Color = Color.Green;
  @mark paint(color: Color): Color {
    return color;
  }
}
console.log(
  read(),
  new Holder().color,
  seen.map(it => (typeof it === "function" ? it.name : JSON.stringify(it))).join(),
);
