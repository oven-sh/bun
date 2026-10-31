// A loop in a function adds to a variable of the module. The function is called before the declaration of the variable has run: with no turn nothing is read and nothing is thrown,
// with a turn the read throws, behind what the turn does first and not ahead of the loop.
const told: string[] = [];

function adds(turns: number): void {
  for (let i = 0; i < turns; i++) {
    told.push("turn " + i);
    late += i + 1;
  }
}

function addsAtOnce(turns: number): void {
  for (let i = 0; i < turns; i++) late += i + 1;
}

function attempt(label: string, act: () => void): void {
  try {
    act();
    console.log(label, "ends", told.join(","));
  } catch (error) {
    console.log(label, "throws", (error as Error).name, told.join(","));
  }
}

attempt("no turn", () => adds(0));
attempt("no turn at once", () => addsAtOnce(0));
attempt("two turns", () => adds(2));
attempt("two turns at once", () => addsAtOnce(2));
let late = 10;
attempt("no turn behind the declaration", () => adds(0));
console.log(late);
attempt("three turns behind the declaration", () => adds(3));
console.log(late);
attempt("three turns at once", () => addsAtOnce(3));
console.log(late);
