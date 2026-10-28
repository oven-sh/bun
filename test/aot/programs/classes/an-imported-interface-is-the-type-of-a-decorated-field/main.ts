// Prints `design:type` of a decorated field whose type is an interface of another file, imported without the word `type`, under `emitDecoratorMetadata`: `Object`, as in what TypeScript's compiler emits.
import { Shape } from "./shape";
(Reflect as any).metadata = (about: string, value: unknown) => (target: object, name: string) => {
  console.log(name, about, value === Object);
};
const mark: any = () => {};
class Holder {
  @mark held: Shape = { side: 2 };
}
console.log(new Holder().held.side);
