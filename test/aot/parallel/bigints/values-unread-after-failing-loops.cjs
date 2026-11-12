// Loops pass these BigInts on, and their only readers follow a reference to an undeclared name. The build aborted: a parameter without readers has no value.
const out = [];
function quotients(n) {
  const state = { a: 1 };
  let list = [3, 1, 2];
  let big = 3n;
  let any = undefined;
  for (let i = 40; i > 0; i -= 3) {
    {
      while (left-- > 0) {
        any = big / 3n;
        for (let k5 = 0; k5 < 3 && list.length; k5++) state.a += list.shift() | 0;
      }
    }
    any = !any;
    any = obj.x?.toString().length ?? "none";
  }
  absent.push([state.a, list, obj, point, big, any].map(show).join(" "));
}
function products(n) {
  let list = [3, 1, 2];
  let big = 3n;
  let any = undefined;
  for (let i = 40; i > 0; i -= 3) {
    {
      do {
        any = big * 3n;
        for (let k5 = 0; k5 < 3 && list.length; k5++) big = any - 1n;
      } while (left-- > 0);
    }
    any = !any;
    any = obj.x?.toString().length ?? "none";
  }
  absent.push([list, big, any].map(show).join(" "));
}
function remainders(n) {
  const state = { a: 1 };
  let list = [3, 1, 2], big = 3n, any = undefined, sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 3; j++) {
      while (left-- > 0) any = (big * big) % 7n;
      for (const k of [1, 2]) sum += k;
    }
    any = !any;
    any = obj.x;
  }
  absent.push([state.a, list, obj, point, big, any, sum].map(show).join(" ").slice(0, 400));
}
for (const n of [3, 5]) {
  try {
    quotients(n);
  } catch (error) {
    out.push(error.name + ": " + error.message);
  }
}
for (const n of [3, 5]) {
  try {
    products(n);
  } catch (error) {
    out.push(error.name + ": " + error.message);
  }
}
for (const n of [3, 5]) {
  try {
    remainders(n);
  } catch (error) {
    out.push(error.name + ": " + error.message);
  }
}
console.log(out.join("\n"));
