function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

function sumTo(n, total) {
  if (n <= 0) return total;
  return sumTo(n - 1, total + n);
}

function factorial(n) {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

function power(base, exponent, result) {
  if (exponent === 0) return result;
  return power(base, exponent - 1, result * base);
}

function countDigits(n, count) {
  if (n < 10) return count + 1;
  return countDigits((n / 10) | 0, count + 1);
}

function fibonacci(n) {
  return n < 2 ? n : fibonacci(n - 1) + fibonacci(n - 2);
}

function collatz(n, steps) {
  if (n === 1 || steps > 200) return steps;
  return collatz(n % 2 === 0 ? n / 2 : n * 3 + 1, steps + 1);
}

function isEven(n) {
  return n === 0 ? true : isOdd(n - 1);
}

function isOdd(n) {
  return n === 0 ? false : isEven(n - 1);
}

for (let i = 0; i < 500; i++) {
  sumTo(i % 20, 0);
  factorial(i % 10);
  gcd(i + 1, 12);
  power(2, i % 10, 1);
  countDigits(i, 0);
  fibonacci(i % 10);
  collatz(1 + (i % 20), 0);
  isEven(i % 20);
}

attempt("sumTo(5, 0)", () => sumTo(5, 0));
attempt("sumTo(5, '')", () => sumTo(5, ""));
attempt("sumTo('5', 0)", () => sumTo("5", 0));
attempt("sumTo(5, 0.5)", () => sumTo(5, 0.5));
attempt("sumTo(5, 0n)", () => sumTo(5, 0n));
attempt("sumTo(5n, 0n)", () => sumTo(5n, 0n));
attempt("sumTo(2.5, 0)", () => sumTo(2.5, 0));
attempt("sumTo(5, 2147483640)", () => sumTo(5, 2147483640));
attempt("sumTo(5)", () => sumTo(5));
attempt("sumTo(5, null)", () => sumTo(5, null));
attempt("factorial(5)", () => factorial(5));
attempt("factorial(13)", () => factorial(13));
attempt("factorial(25)", () => factorial(25));
attempt("factorial(171)", () => factorial(171));
attempt("factorial('5')", () => factorial("5"));
attempt("factorial(5.5)", () => factorial(5.5));
attempt("factorial(5n)", () => factorial(5n));
attempt("gcd(12, 18)", () => gcd(12, 18));
attempt("gcd('12', 18)", () => gcd("12", 18));
attempt("gcd(12, '18')", () => gcd(12, "18"));
attempt("gcd(-12, 18)", () => gcd(-12, 18));
attempt("gcd(12, -18)", () => gcd(12, -18));
attempt("gcd(-12, -12)", () => gcd(-12, -12));
attempt("gcd(12n, 18n)", () => gcd(12n, 18n));
attempt("gcd(2147483647, 2147483646)", () => gcd(2147483647, 2147483646));
attempt("gcd(-2147483648, -1)", () => gcd(-2147483648, -1));
attempt("gcd(1.5, 0.5)", () => gcd(1.5, 0.5));
attempt("power(2, 31, 1)", () => power(2, 31, 1));
attempt("power(2, 64, 1)", () => power(2, 64, 1));
attempt("power('2', 3, 1)", () => power("2", 3, 1));
attempt("power(2, 3, '1')", () => power(2, 3, "1"));
attempt("power(2n, 3, 1n)", () => power(2n, 3, 1n));
attempt("power(2n, 3, 1)", () => power(2n, 3, 1));
attempt("power(-0, 3, 1)", () => power(-0, 3, 1));
attempt("countDigits(12345, 0)", () => countDigits(12345, 0));
attempt("countDigits('12345', 0)", () => countDigits("12345", 0));
attempt("countDigits(4294967296, 0)", () => countDigits(4294967296, 0));
attempt("countDigits(12345.678, 0)", () => countDigits(12345.678, 0));
attempt("countDigits(12345, '')", () => countDigits(12345, ""));
attempt("fibonacci(20)", () => fibonacci(20));
attempt("fibonacci('7')", () => fibonacci("7"));
attempt("fibonacci(7.5)", () => fibonacci(7.5));
attempt("fibonacci(7n)", () => fibonacci(7n));
attempt("fibonacci(true)", () => fibonacci(true));
attempt("collatz(27, 0)", () => collatz(27, 0));
attempt("collatz('27', 0)", () => collatz("27", 0));
attempt("collatz(2.5, 0)", () => collatz(2.5, 0));
attempt("collatz(113383, 0)", () => collatz(113383, 0));
attempt("isEven(10)", () => isEven(10));
attempt("isEven('10')", () => isEven("10"));
attempt("isEven(-0)", () => isEven(-0));
