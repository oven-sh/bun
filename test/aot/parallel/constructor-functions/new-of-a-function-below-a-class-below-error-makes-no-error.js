class Failure extends Error {}
function Other() {}
Other.prototype = Object.create(Failure.prototype);

const plain = new Other();
console.log(Error.isError(plain), Object.prototype.toString.call(plain), JSON.stringify(plain.message), typeof plain.stack, Object.keys(plain).join(), plain instanceof Error, String(plain));
plain.message = "late";
console.log(plain.message, Object.keys(plain).join(), String(plain));

const failure = Reflect.construct(Failure, ["early"], Other);
console.log(Error.isError(failure), Object.prototype.toString.call(failure), failure.message, typeof failure.stack, Object.keys(failure).join(), failure instanceof Error, String(failure));

let errors = 0;
let texts = 0;
for (let i = 0; i < 5000; i++) {
  const either = i & 1 ? new Other() : Reflect.construct(Failure, ["x"], Other);
  if (Error.isError(either)) errors++;
  texts += either.message.length + (typeof either.stack === "string" ? 10 : 0);
}
console.log(errors, texts);
