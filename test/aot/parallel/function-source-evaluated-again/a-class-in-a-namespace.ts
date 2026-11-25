// Classes of namespaces, exported and not, one level deeper too.
namespace Yard {
  export class Gate { constructor(public wide: number) {} }
  class Latch { constructor(readonly shut: boolean) {} }
  export const latchText = String(Latch);
  export namespace Back { export class Shed { constructor(private tools: number, public roof = "flat") {} count() { return this.tools; } } }
}
const evaluate = (text: string): any => (0, eval)("(" + text + ")");
console.log(JSON.stringify(new (evaluate(String(Yard.Gate)))(3)));
console.log(JSON.stringify(new (evaluate(Yard.latchText))(true)));
const shed = new (evaluate(String(Yard.Back.Shed)))(7);
console.log(JSON.stringify(shed), shed.count());
