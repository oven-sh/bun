const box = { value: 1 };
Object.assign.apply(null, [box, { value: "text" }]);
console.log(typeof box.value, box.value.length);
