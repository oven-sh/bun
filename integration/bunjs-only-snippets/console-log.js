console.log("Hello World!");
console.log(123);
console.log(123.567);
console.log(true);
console.log(false);
console.log(new Date());
console.log([123, 456, 789]);
console.log({ a: 123, b: 456, c: 789 });
console.log({
  a: {
    b: {
      c: 123,
    },
    bacon: true,
  },
});

console.log(new Promise(() => {}));

class Foo {}

console.log(() => {});
console.log(Foo);
console.log(new Foo());
console.log(function foooo() {});

console.log(/FooRegex/);

console.error("uh oh");
console.time("Check");

console.log("Before clear");
console.clear();
console.log("After clear");

console.log("Formatting specifier %s, %d ok", "foo", 123);
