const steps = "a😀"[Symbol.iterator]();
console.log(steps.next().value.length, steps.next().value.length, steps.next().value === undefined);
