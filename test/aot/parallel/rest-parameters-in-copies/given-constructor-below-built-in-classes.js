class List extends Array {}
class Failure extends Error {}
class Table extends Map {}
class Bytes extends Uint8Array {}
class Pending extends Promise {}
for (let i = 1; i < 4; i++) {
  const list = new List(i, 2), sized = new List(i), failure = new Failure("m" + i, { cause: i }), table = new Table([[i, i]]), bytes = new Bytes(i);
  console.log(list.length, sized.length, list instanceof List, failure.message, failure.cause, failure instanceof Failure, table.get(i), table.size, bytes.length, bytes instanceof Bytes);
}
new Pending(resolve => resolve(7)).then(value => console.log(value));
