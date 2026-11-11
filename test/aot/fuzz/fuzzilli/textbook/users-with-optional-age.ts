interface User {
  name: string;
  age?: number;
}
function user(name: string, age?: number): User {
  return age === undefined ? { name } : { name, age };
}
function run() {
  const ann = user("ann", 7);
  const bob = user("bob");
  console.log(JSON.stringify(ann), JSON.stringify(bob), ann.age, bob.age);
}
run();
