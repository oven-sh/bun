// Alone: the second evaluation of a class is known by no table: beside other programs its guards may be left.
// The same with class fields and no factory: the heir's field was stored and read, and no listing of the keys showed it.
for (let i = 0; i < 3; i++) {
  class B extends class { a = i; } { b = 5; }
  delete B.prototype.constructor;
  const made = new B();
  const keys = [];
  for (const key in made) keys.push(key);
  console.log(JSON.stringify(made), keys.join(), made.b, Object.entries(made).join("|"));
  console.log(made, structuredClone(made), Object.assign({}, made));
}
for (let i = 0; i < 3; i++) {
  class B extends class { a = i; } { b = 5; c = [i]; }
  const first = new B();
  delete B.prototype.constructor;
  console.log(JSON.stringify(first), JSON.stringify(new B()));
}
