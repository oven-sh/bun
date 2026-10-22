const helper = [1.5, "two", { three: 3 }].values().map(value => [value]).drop(1).take(2);
console.log(helper.next().value[0].length, helper.next().value[0].three + 1, helper.next().done, helper.next().value === undefined);
