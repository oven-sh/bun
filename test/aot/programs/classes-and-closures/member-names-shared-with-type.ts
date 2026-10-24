// The name of a member of a class is also a string literal in the type of a field, and no expression spells it: the class still has the member under its name.
type Mode = "plain" | "sealedStaticMethod" | "sealedStaticGetter" | "sealedStaticSetter" | "sealedMethod" | "sealedGetter" | "sealedStaticField" | "sealedField";
interface Options {
  mode: Mode;
  limit: number;
}
class Tools {
  static sealedStaticMethod(): number {
    return 1;
  }
  static get sealedStaticGetter(): number {
    return 2;
  }
  static set sealedStaticSetter(value: number) {}
  static sealedStaticField = 3;
  sealedMethod(): number {
    return 4;
  }
  get sealedGetter(): number {
    return 5;
  }
  sealedField = 6;
}
const options: Options = { mode: "plain", limit: 1 };
const longNames = (names: string[]) => names.filter(name => name.length > 9).sort().join();
console.log(options.mode, options.limit);
console.log(longNames(Object.getOwnPropertyNames(Tools)));
console.log(longNames(Object.getOwnPropertyNames(Tools.prototype)));
console.log(longNames(Object.keys(new Tools())));
for (const name of Object.getOwnPropertyNames(Tools)) {
  if (name.length > 9) console.log(name, typeof (Tools as any)[name], typeof Object.getOwnPropertyDescriptor(Tools, name)!.get);
}
const tools: any = new Tools();
for (const name of Object.getOwnPropertyNames(Tools.prototype)) {
  if (name.length > 9) console.log(name, typeof tools[name]);
}
