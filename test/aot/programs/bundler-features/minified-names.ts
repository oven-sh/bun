// With --minify a name that only an identifier spells is renamed, by a plain build and by --aot alike; what a property spells stays. The tokens differ between the two, so only what holds of both is printed.
declare const console: { log(...args: unknown[]): void }
function declaredFunction(): number { return 1 }
const arrowInConst = (): number => 2
let functionInLet = function (): number { return 3 }
class DeclaredClass {
  methodOfClass(): number { return 5 }
  static staticMethod(): void {}
  get getterOfClass(): number { return 6 }
  fieldArrow = (): number => 7
}
const classInConst = class {}
const objectLiteral = { shorthandMethod(): void {}, propertyFunction: function (): void {}, propertyArrow: (): void => {} }
function outer(): { name: string }[] {
  function nestedFunction(): void {}
  function otherNestedFunction(): void { nestedFunction() }
  return [nestedFunction, otherNestedFunction]
}
const isShort = (f: { name: string }): boolean => f.name.length > 0 && f.name.length < 4
console.log("renamed:", [declaredFunction, arrowInConst, functionInLet, DeclaredClass, classInConst, ...outer()].map(isShort).join())
const made = new DeclaredClass()
console.log("kept:", made.methodOfClass.name, DeclaredClass.staticMethod.name, made.fieldArrow.name, objectLiteral.shorthandMethod.name, objectLiteral.propertyFunction.name, objectLiteral.propertyArrow.name)
console.log("one text, one token:", made.constructor.name === DeclaredClass.name, declaredFunction.name !== arrowInConst.name, DeclaredClass.name !== classInConst.name)
function thrower(): never { throw new Error("thrown") }
function stackOf(run: () => unknown): string { try { run() } catch (e) { return String((e as Error).stack) } return "" }
const stack = stackOf(thrower)
console.log("stack:", stack.split("\n")[0], stack.includes(".ts"), /\bat \w{1,3} \(/.test(stack), /:\d+:\d+\)?$/m.test(stack))
console.log(declaredFunction() + arrowInConst() + functionInLet() + made.methodOfClass() + made.getterOfClass + made.fieldArrow())
interface Settings { name: string; memberOnlyATypeDeclares?: string; objectOnlyATypeDeclares?: { nestedMemberOnlyATypeDeclares: number } }
function makeSettings(name: string): Settings { return { name } }
const fromOutside = JSON.parse('{"name":"outside","memberOnlyATypeDeclares":"held","other":1}') as Settings
const keyFromOutside = Object.keys(fromOutside)[1]!
const settings = makeSettings("made")
const asRecord = settings as unknown as Record<string, unknown>
console.log("members:", settings.name, fromOutside.name, Object.keys(fromOutside).join(), JSON.stringify(fromOutside), Object.keys(settings).join(), asRecord[keyFromOutside], keyFromOutside in asRecord)
asRecord[keyFromOutside] = 7
console.log("members:", asRecord[keyFromOutside], keyFromOutside in asRecord, Object.keys(settings).join(), JSON.stringify(settings), (fromOutside as unknown as Record<string, unknown>)[keyFromOutside])
