// @ts-nocheck
enum Numbers {
  one = 21,
}
enum Texts {
  name = "text",
}
const alias = Numbers.one,
  again = alias;
class Above {}
for (const name of ["y", "21", "-21", "22", "text", "textx", "number"]) {
  Object.defineProperty(Above.prototype, name, {
    set(value: unknown) {
      console.log("  set", name, "to", value);
    },
    configurable: true,
  });
}
const keys = (o: object) => Reflect.ownKeys(o).map(String).join("+") || "none";
export function run(setting: string) {
  class Field0 extends Above { [Numbers.one] = 1; y = 2; optional?: number; }
  console.log(setting, "field, member:", keys(new Field0()));
  class Field1 extends Above { [Texts.name] = 1; y = 2; optional?: number; }
  console.log(setting, "field, text:", keys(new Field1()));
  class Field2 extends Above { [Numbers["one"]] = 1; y = 2; optional?: number; }
  console.log(setting, "field, in brackets:", keys(new Field2()));
  class Field3 extends Above { [Numbers.one as number] = 1; y = 2; optional?: number; }
  console.log(setting, "field, asserted:", keys(new Field3()));
  class Field4 extends Above { [Numbers.one!] = 1; y = 2; optional?: number; }
  console.log(setting, "field, not null:", keys(new Field4()));
  class Field5 extends Above { [(Numbers.one)] = 1; y = 2; optional?: number; }
  console.log(setting, "field, in parentheses:", keys(new Field5()));
  class Field6 extends Above { [alias] = 1; y = 2; optional?: number; }
  console.log(setting, "field, constant:", keys(new Field6()));
  class Field7 extends Above { [again] = 1; y = 2; optional?: number; }
  console.log(setting, "field, constant of a constant:", keys(new Field7()));
  class Field8 extends Above { [true ? Numbers.one : 0] = 1; y = 2; optional?: number; }
  console.log(setting, "field, chosen:", keys(new Field8()));
  class Field9 extends Above { [false ? 0 : Numbers.one] = 1; y = 2; optional?: number; }
  console.log(setting, "field, chosen by false:", keys(new Field9()));
  class Field10 extends Above { [Numbers.one ? Numbers.one : 0] = 1; y = 2; optional?: number; }
  console.log(setting, "field, chosen by a member:", keys(new Field10()));
  class Field11 extends Above { [0 || Numbers.one] = 1; y = 2; optional?: number; }
  console.log(setting, "field, behind ||:", keys(new Field11()));
  class Field12 extends Above { [Numbers.one || 0] = 1; y = 2; optional?: number; }
  console.log(setting, "field, in front of ||:", keys(new Field12()));
  class Field13 extends Above { [1 && Numbers.one] = 1; y = 2; optional?: number; }
  console.log(setting, "field, behind &&:", keys(new Field13()));
  class Field14 extends Above { [null ?? Numbers.one] = 1; y = 2; optional?: number; }
  console.log(setting, "field, behind ??:", keys(new Field14()));
  class Field15 extends Above { [Numbers.one ?? 0] = 1; y = 2; optional?: number; }
  console.log(setting, "field, in front of ??:", keys(new Field15()));
  class Field16 extends Above { [true ? 0 || Numbers.one : 0] = 1; y = 2; optional?: number; }
  console.log(setting, "field, chosen twice:", keys(new Field16()));
  class Field17 extends Above { [(true ? Numbers.one : 0) as number] = 1; y = 2; optional?: number; }
  console.log(setting, "field, chosen and asserted:", keys(new Field17()));
  class Field18 extends Above { [(0, Numbers.one)] = 1; y = 2; optional?: number; }
  console.log(setting, "field, behind a comma:", keys(new Field18()));
  class Field19 extends Above { [[Numbers.one][0]] = 1; y = 2; optional?: number; }
  console.log(setting, "field, out of a list:", keys(new Field19()));
  class Field20 extends Above { [-Numbers.one] = 1; y = 2; optional?: number; }
  console.log(setting, "field, negated:", keys(new Field20()));
  class Field21 extends Above { [true ? -Numbers.one : 0] = 1; y = 2; optional?: number; }
  console.log(setting, "field, negated and chosen:", keys(new Field21()));
  class Field22 extends Above { [+Numbers.one] = 1; y = 2; optional?: number; }
  console.log(setting, "field, plus:", keys(new Field22()));
  class Field23 extends Above { [Numbers.one + 1] = 1; y = 2; optional?: number; }
  console.log(setting, "field, sum:", keys(new Field23()));
  class Field24 extends Above { [`${Numbers.one}`] = 1; y = 2; optional?: number; }
  console.log(setting, "field, template:", keys(new Field24()));
  class Field25 extends Above { [Texts.name + "x"] = 1; y = 2; optional?: number; }
  console.log(setting, "field, texts joined:", keys(new Field25()));
  class Field26 extends Above { [typeof Numbers.one] = 1; y = 2; optional?: number; }
  console.log(setting, "field, type of:", keys(new Field26()));
  class Field27 extends Above { [typeof (true ? Numbers.one : 0)] = 1; y = 2; optional?: number; }
  console.log(setting, "field, type of what is chosen:", keys(new Field27()));
  class Field28 extends Above { [21] = 1; y = 2; optional?: number; }
  console.log(setting, "field, number:", keys(new Field28()));
  class Field29 extends Above { [true ? 21 : 0] = 1; y = 2; optional?: number; }
  console.log(setting, "field, number chosen:", keys(new Field29()));
  {
    class C extends Above { static [Numbers.one] = 1; y = 2; optional?: number; }
    console.log(setting, "static field:", keys(new C()), keys(C));
  }
  {
    class C extends Above { static [true ? Numbers.one : 0] = 1; y = 2; optional?: number; }
    console.log(setting, "static field, chosen:", keys(new C()), keys(C));
  }
  {
    class C extends Above { [0 || Numbers.one]; y = 2; optional?: number; }
    console.log(setting, "field without a value:", keys(new C()));
  }
  {
    class C extends Above { [Numbers.one]() {} y = 2; optional?: number; }
    console.log(setting, "method:", keys(new C()), keys(C.prototype));
  }
  {
    class C extends Above { [true ? Numbers.one : 0]() {} y = 2; optional?: number; }
    console.log(setting, "method, chosen:", keys(new C()), keys(C.prototype));
  }
  {
    class C extends Above { static [0 || Numbers.one]() {} y = 2; optional?: number; }
    console.log(setting, "static method:", keys(new C()), keys(C));
  }
  {
    class C extends Above { get [Numbers.one]() { return 1; } y = 2; optional?: number; }
    console.log(setting, "getter:", keys(new C()), keys(C.prototype), new C()[21]);
  }
  {
    class C extends Above { get [0 || Numbers.one]() { return 1; } y = 2; optional?: number; }
    console.log(setting, "getter, chosen:", keys(new C()), keys(C.prototype), new C()[21]);
  }
  {
    class C extends Above { accessor [Numbers.one] = 1; y = 2; optional?: number; }
    console.log(setting, "accessor:", keys(new C()), keys(C.prototype), new C()[21]);
  }
  {
    class C extends Above { accessor [true ? Numbers.one : 0] = 1; y = 2; optional?: number; }
    console.log(setting, "accessor, chosen:", keys(new C()), keys(C.prototype), new C()[21]);
  }
  console.log(setting, "object literal:", keys({ [Numbers.one]: 1, [Texts.name]: 2, [-Numbers.one]: 3 }), keys({ [true ? Numbers.one : 0]: 1, [0 || Texts.name]: 2 }));
  const { [Numbers.one]: taken, [0 || Texts.name]: other, [true ? -Numbers.one : 0]: third } = { 21: "a", text: "b", "-21": "c" };
  console.log(setting, "pattern:", taken, other, third);
}
