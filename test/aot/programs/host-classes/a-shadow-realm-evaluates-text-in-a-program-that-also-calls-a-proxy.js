// What a ShadowRealm evaluates does not depend on whether the program calls a proxy somewhere else.
const realm = new ShadowRealm();
console.log(realm.evaluate(`1 + 1`));
console.log(new Proxy(function () { return 7; }, {})());
