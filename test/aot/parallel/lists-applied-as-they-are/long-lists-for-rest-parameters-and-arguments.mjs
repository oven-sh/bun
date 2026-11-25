function long(n) { const list = []; for (let i = 0; i < n; i++) list.push(i % 3 === 0 ? i : i % 3 === 1 ? i + 0.5 : "t" + i); return list; }
function ends(...all) { all.push("last"); return [all.length, all[0], all[1], all[all.length - 2], all[all.length - 1], Array.isArray(all), all.indexOf("t2")].join(":"); }
function endsOfArguments() { return [arguments.length, arguments[0], arguments[1], arguments[arguments.length - 1]].join(":"); }
function behindTwo(a, b, ...others) { return [a, b, others.length, others[0], others[others.length - 1]].join(":"); }
for (const n of [0, 1, 4, 5, 126, 127, 128, 129, 130, 200, 1000, 5000, 60000]) {
  const list = long(n);
  console.log(n, ends.apply(null, list), ends(...list), endsOfArguments.apply(null, list), behindTwo(...list), Reflect.apply(behindTwo, null, list));
}
