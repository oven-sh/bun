// Inside `with` a name is looked for in the object first: a constant of the function around it is read, deleted and called by name there, and only the object's property changes.
function read(scope) {
  const count = 1;
  with (scope) {
    return [count, typeof count];
  }
}
function readLater(scope) {
  const count = 1;
  with (scope) {
    return () => count;
  }
}
function remove(scope) {
  const count = 1;
  with (scope) {
    return [delete count, "count" in scope];
  }
}
function call(scope) {
  const count = 1;
  with (scope) {
    try {
      return count();
    } catch (error) {
      return error.constructor.name;
    }
  }
}
function readInLaterCase(which, scope) {
  switch (which) {
    case 1:
      const count = 1;
    case 2:
      with (scope) {
        return count;
      }
  }
}
console.log("read", JSON.stringify([read({ count: 2 }), read({})]));
console.log("read later", readLater({ count: 2 })(), readLater({})());
console.log("remove", JSON.stringify([remove({ count: 2 }), remove({})]));
console.log("call", call({ count: () => "object" }), call({}));
console.log("later case", readInLaterCase(1, { count: 2 }), readInLaterCase(1, {}));
