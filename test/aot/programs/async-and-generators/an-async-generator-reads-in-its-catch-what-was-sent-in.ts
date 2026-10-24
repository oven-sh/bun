// What is sent into an async generator is assigned inside a try, and the catch reads the variable.
function check(value: any): void {
  if (value > 1) throw new Error("over");
}
async function* steps(): AsyncGenerator<number, void, any> {
  let seen: any = 0;
  try {
    seen = yield 1;
    check(seen);
    seen = yield 2;
    check(seen);
  } catch (error) {
    console.log("caught with", seen);
  }
}
const it = steps();
for (let round = 0; round < 3; round++) console.log(JSON.stringify(await it.next(round)));
