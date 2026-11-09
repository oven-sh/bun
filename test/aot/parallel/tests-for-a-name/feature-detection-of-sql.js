const has = typeof Bun !== "undefined" && "sql" in Bun;
console.log(has);
console.log("end");
