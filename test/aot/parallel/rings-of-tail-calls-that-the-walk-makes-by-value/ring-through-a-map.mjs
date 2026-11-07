const registry = new Map();
class Stage {
  run(n) {
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + i) | 0;
    if (n === 0) return work;
    return registry.get("next").run(n - 1);
  }
}
class Idle {
  run(n) {
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + i) | 0;
    return (work + n) | 0;
  }
}
registry.set("next", new Stage());
console.log(new Idle().run(1));
console.log(new Stage().run(10));
let answer;
try { answer = new Stage().run(1000000); } catch (e) { answer = e.name; }
console.log(answer);
