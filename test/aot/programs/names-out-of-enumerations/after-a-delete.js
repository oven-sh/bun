// The own property is taken away between the step of the enumeration and the read: the lookup goes on to Object.prototype, whose member of the same name is not enumerable.
function afterDelete(o) {
  const found = [];
  for (const name in o) {
    delete o[name];
    found.push(typeof o[name], o[name] === Object, o[name] === Object.prototype.toString);
  }
  return found.join();
}
console.log(afterDelete({ constructor: 1, toString: 2, plain: 3 }));
