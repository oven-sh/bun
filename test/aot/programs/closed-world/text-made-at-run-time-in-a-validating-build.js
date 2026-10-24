// The text of these functions is put together at run time, so code that the compiler has not seen may run. Functions of the runtime's own modules that nothing calls get an entry that refuses such code, and a validating build accepts that entry.
const storing = statement => new Function("list", "list.tag = 1; " + statement);
const stores = [storing("list.label = 'plain';"), storing("list.other = 2;")];
for (const store of stores) {
  const list = [1, 2, 3];
  store(list);
  console.log(Object.keys(list).join());
}
