const key = JSON.parse('"constructor"');
console.log(Reflect.defineProperty(new Map()[key], "groupBy", { value: () => "mine" }));
console.log(Map.groupBy([1], x => x));
