const key = JSON.parse('"__proto__"');
console.log(Reflect.defineProperty("x"[key], "at", { value: () => "mine" }));
console.log("abc".at(0));
