const forms = {
  redefinedHalves: { get a() { return 1; }, set a(v) {}, b: 1, get a() { return 2; }, c: 1, set a(v) {} },
  getterAgain: { get a() { return 1; }, b: 1, get a() { return 2; } },
  setterLater: { get a() { return 1; }, b: 1, set a(v) {} },
  valueThenGetter: { a: 1, b: 1, get a() { return 2; } },
  getterThenValue: { get a() { return 1; }, b: 1, a: 2 },
  valueAgain: { a: 1, b: 1, a: 2 },
  pairThenGetterThenSetter: { get a() { return 1; }, set a(v) {}, b: 1, get a() { return 2; } },
  pairThenSetter: { get a() { return 1; }, set a(v) {}, b: 1, set a(v) {} },
};
for (const name of Object.keys(forms)) console.log(name, Object.keys(forms[name]).join(","), JSON.stringify(Object.getOwnPropertyNames(forms[name])), Reflect.ownKeys(forms[name]).join(","));
