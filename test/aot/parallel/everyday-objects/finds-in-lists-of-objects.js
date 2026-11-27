// find, findLast, some, every, indexOf and includes over instances
class User {
  constructor(id, age) {
    this.id = id;
    this.age = age;
  }
}
function ask(ages, limit) {
  const users = ages.map((age, id) => new User(id, age));
  const old = users.find(user => user.age > limit);
  const last = users.findLast(user => user.age > limit);
  return [old?.id, last?.id, users.indexOf(old), users.lastIndexOf(last), users.some(user => user.age === limit), users.every(user => user.age >= limit), users.includes(new User(0, ages[0])), users.findIndex(({ age }) => age < limit)].map(String).join();
}
console.log(ask([20, 30, 40], 25));
console.log(ask([5, 5, 5], 5));
console.log(ask([1], 10));
