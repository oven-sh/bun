function target(first, second, third, fourth, fifth) {
  console.log(typeof first, first + 1);
}
Reflect.apply(target, undefined, { length: 5, 0: 0.5, 1: 1, 2: 2, 3: 3, 4: 4 });
