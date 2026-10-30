// A file name is joined from parts, and one part is read out of a list or an object that the program changes after it is written.
const walked = ["ONE", "TWO"];
walked.forEach((name, index, all) => {
  all[index] = name.toLowerCase();
});
console.log((await import(["./walked", walked[1] + ".mjs"].join("/"))).label);

const sorted = ["two", "one"];
sorted.sort();
console.log((await import(["./sorted", sorted[1] + ".mjs"].join("/"))).label);

const shared = ["ONE", "TWO"];
const same = shared;
same[1] = "two";
console.log((await import(["./shared", shared[1] + ".mjs"].join("/"))).label);

const table = { key: "ONE" };
Object.assign(table, { key: "two" });
console.log((await import(["./table", table.key + ".mjs"].join("/"))).label);

const spliced = ["ONE", "TWO"];
spliced.splice(1, 1, "two");
const parts = ["./spliced"];
parts.push(spliced[1] + ".mjs");
console.log((await import(parts.join("/"))).label);

const whole = ["ONE.mjs", "TWO.mjs"];
whole[1] = "two.mjs";
console.log((await import(["./whole", whole[1]].join("/"))).label);

const mapped = ["ONE", "TWO"];
mapped.shift();
mapped[0] = "two";
for (const file of mapped.map(name => ["./mapped", name + ".mjs"].join("/"))) console.log((await import(file)).label);
