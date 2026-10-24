// The formatter of console.log and Bun.inspect walks over every member. What makes the members of `process` is in the executable, so the walk ends as in plain Bun.
console.log(Bun.inspect(process).length > 100);
