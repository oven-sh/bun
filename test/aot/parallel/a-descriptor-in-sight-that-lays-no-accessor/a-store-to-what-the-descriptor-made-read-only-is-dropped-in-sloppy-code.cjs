const box = { kept: 1, mark: 0 };
Object.defineProperty(box, "mark", { value: 7, writable: false });
function put(target, n) { for (let i = 0; i < n; i++) { target.mark = i; target.kept = i; } return target.mark; }
console.log(put(box, 30), box.mark, box.kept, JSON.stringify(Object.getOwnPropertyDescriptor(box, "mark")));
