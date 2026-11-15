// Objects made of closures over one hidden record
function account(sum) {
  const history = [];
  const move = n => {
    sum += n;
    history.push(n);
    return api;
  };
  const api = {
    deposit: n => move(n),
    withdraw: n => (n > sum ? api : move(-n)),
    get sum() {
      return sum;
    },
    history: () => [...history],
  };
  return api;
}
function run(start, n) {
  const a = account(start), b = account(0);
  a.deposit(n).withdraw(n * 3).withdraw(1);
  b.deposit(a.sum);
  a.history().push(999);
  return a.sum + " " + b.sum + " " + a.history().join();
}
console.log(run(10, 5));
console.log(run(0, 1));
console.log(run(100, 50));
