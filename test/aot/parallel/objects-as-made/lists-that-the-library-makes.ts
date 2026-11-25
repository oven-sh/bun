function ask(list: any[]): string { let sum = 0; for (let at = 0; at < list.length; at++) sum += String(list[at]).length; for (const x of list) sum += String(x).length; list.push("z"); return sum + "," + list.indexOf("b") + list.includes("z") + list.join("") + list.pop() + list.length; }
let all = "";
all += ask("a,b,c".split(",")) + ";" + ask(Array.from("abc")) + ";" + ask(Array.of("a", "b")) + ";" + ask(new Array(3)) + ";" + ask(new Array("a", "b")) + ";" + ask(JSON.parse('["a","b",1]')) + ";";
all += ask(Object.keys({ a: 1, b: 2 })) + ";" + ask(Object.entries({ a: 1 })) + ";" + ask([..."ab"]) + ";" + ask(["a", "b"].concat(["c"])) + ";" + ask(["b", "a"].toSorted()) + ";" + ask(structuredClone(["a", "b"])) + ";";
all += ask(Array.from({ length: 2 }, (_, at) => "b" + at)) + ";" + ask(Array.prototype.slice.call({ 0: "a", 1: "b", length: 2 })) + ";" + ask(Reflect.ownKeys({ b: 1 })) + ";" + ask([["a", "b"]].flat()) + ";" + ask(Array(2).fill("b"));
console.log(all);
