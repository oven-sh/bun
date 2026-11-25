// Nested records updated by copies; what is shared stays the same
function update(state, name, n) {
  const next = { ...state, users: state.users.map(user => (user.name === name ? { ...user, n: user.n + n } : user)), count: state.count + 1 };
  return next;
}
function run(n) {
  const first = { users: [{ name: "a", n }, { name: "b", n: n * 2 }], count: 0, kept: { deep: n } };
  const second = update(first, "b", 5);
  const third = update(second, "none", 1);
  const same = [first.users[0] === third.users[0], first.users[1] === second.users[1], second.users[1] === third.users[1], first.kept === third.kept];
  return third.users.map(user => user.name + user.n).join() + " " + third.count + " " + same.join() + " " + first.users[1].n;
}
console.log(run(1));
console.log(run(30));
console.log(run(0));
