const shared = { value: 1.5 };
const copy = structuredClone({ left: shared, right: shared });
copy.left.value = "text";
console.log(copy.left === copy.right, copy.right.value.length, shared.value + 1);
