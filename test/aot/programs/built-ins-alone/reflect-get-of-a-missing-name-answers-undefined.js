const missing = Reflect.get({ present: 1.5 }, "absent");
console.log(missing === undefined, typeof missing, Reflect.get({ present: 1.5 }, "present") + 1);
