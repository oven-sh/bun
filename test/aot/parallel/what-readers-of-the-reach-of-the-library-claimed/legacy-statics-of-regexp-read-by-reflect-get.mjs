const ok = /(\d+)-(\d+)/.test("tel 12-34");
console.log(ok, JSON.stringify([Reflect.get(RegExp, "$1"), Reflect.get(RegExp, "lastMatch")]));
