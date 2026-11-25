const show = (o) => Object.keys(o).join() + " " + JSON.stringify(o);
console.log(show(new Map(new Map([["k", { "-1": "unknown", name: "x" }]])).get("k")));
