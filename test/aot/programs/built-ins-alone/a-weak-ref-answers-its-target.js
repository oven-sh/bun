const target = { size: 1.5 };
console.log(new WeakRef(target).deref().size + 1, new WeakRef(target).deref() === target);
