// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
console.log(Object.create(new URL("https://example.com/a?b=c")));
class Address extends URL {}
console.log(new Address("https://example.com/x"));
