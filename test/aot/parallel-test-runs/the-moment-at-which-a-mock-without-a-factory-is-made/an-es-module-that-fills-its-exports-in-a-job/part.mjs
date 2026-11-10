export let a = 1;
export let late;
queueMicrotask(() => { a = 2; late = 3; });
