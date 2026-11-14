// Optional chains with delete, computed keys that have effects, and calls of methods
function chain(depth) {
  let reads = 0;
  const key = () => (reads++, "next");
  let list = null;
  for (let i = 0; i < depth; i++) list = { value: i, next: list, size() { return 1 + (this.next?.size() ?? 0); } };
  const deleted = delete list?.next?.next;
  return [list?.[key()]?.[key()]?.value, list?.size(), deleted, reads].map(String).join();
}
console.log(chain(3));
console.log(chain(1));
console.log(chain(0));
