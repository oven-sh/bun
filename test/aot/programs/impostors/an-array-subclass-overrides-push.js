class Foo extends Array {
  push(value) {
    return 42;
  }
}

function check(condition, message) {
  console.log(condition ? "ok" : "WRONG", message);
}

function pushInto(list, value) {
  return list.push(value);
}

const arr = new Foo(123);
check(arr.push(123) === 42, "the subclass's push runs");
check(Array.isArray(arr), "an instance of the subclass is an array");
check(!arr.includes(123), "nothing was added");
check(arr.length === 123, "new Foo(123) has 123 holes");
check(arr instanceof Foo && arr instanceof Array, "it is an instance of both");
check(!(0 in arr), "its first element is a hole");

const plain = [];
for (let i = 0; i < 2000; i++) pushInto(plain, i);
check(plain.length === 2000, "2000 pushes into a plain array");
check(pushInto(arr, 7) === 42, "the same call site then meets the subclass");
check(arr.length === 123, "and adds nothing");
check(pushInto(plain, 7) === 2001, "and meets the plain array again");

const mapped = arr.map(() => 1);
check(mapped instanceof Foo, "map makes a Foo through Symbol.species");
check(mapped.push(1) === 42, "whose push is the subclass's");

const shadowed = [1, 2, 3];
shadowed.push = () => "own";
check(pushInto(shadowed, 4) === "own", "an own property named push hides the built-in");
check(shadowed.length === 3, "and adds nothing");

const relinked = [1, 2, 3];
check(pushInto(relinked, 4) === 4, "an array before its prototype changes");
Object.setPrototypeOf(relinked, Foo.prototype);
check(pushInto(relinked, 5) === 42, "the same array after it");
check(relinked.length === 4, "which adds nothing");
check(Array.isArray(relinked), "and is still an array");

const bare = [1, 2, 3];
Object.setPrototypeOf(bare, null);
try {
  pushInto(bare, 4);
  check(false, "an array without a prototype has no push");
} catch (error) {
  check(error instanceof TypeError, "an array without a prototype has no push");
}
check(Array.isArray(bare) && bare.length === 3, "but it is an array of three");
