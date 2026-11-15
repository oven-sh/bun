const registry = new Map();
class Half { run(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; if (n === 0) return work + 0.5; return registry.get("half").run(n - 1); } }
class Flag { test(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; if (n === 0) return work === 1; return registry.get("flag").test(n - 1); } }
class Idle { run(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return work + n + 0.25; } test(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return work === n; } }
registry.set("half", new Half()); registry.set("flag", new Flag());
console.log(new Idle().run(1), new Idle().test(1));
let answer; try { answer = new Half().run(1000000) + ":" + new Flag().test(1000000); } catch (e) { answer = e.name; }
console.log(answer);
