var realm = new ShadowRealm();

console.log(realm.evaluate("import('hi').then(a => a);"));
