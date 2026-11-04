// narrowing behind it
interface Box { value?: { size: number } }
function ask(box: Box | undefined): number { const empty = !(box && box.value && box.value.size); return empty ? -1 : box!.value!.size; }
console.log(ask(undefined), ask({}), ask({ value: { size: 0 } }), ask({ value: { size: 7 } }));
