interface Person {
  name: string;
  age: number;
  greet(): string;
}
function build(given: object): Person {
  return Object.assign({ age: 7 }, given) as unknown as Person;
}
function read(person: Person) {
  return [person.name, person.age, typeof person.greet, "name" in person, Object.hasOwn(person, "greet")].join();
}
const bare = build({});
const whole = build({ name: "Ada", greet: () => "hello" });
console.log(read(bare), Object.keys(bare).join(), JSON.stringify(bare));
console.log(read(whole), Object.keys(whole).join(), whole.greet());
let failure = "none";
try {
  bare.greet();
} catch (error) {
  failure = (error as Error).constructor.name;
}
console.log(failure);
