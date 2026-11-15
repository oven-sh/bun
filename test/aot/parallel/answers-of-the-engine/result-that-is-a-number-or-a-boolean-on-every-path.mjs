// A function whose result is proven a number, an int32 or a boolean returns it raw. If caller and callee did not agree on the form, or the form held less than the function returns (a fraction, -0, NaN, an infinity, an integer past int32), each of these would be another value.
// With no callee copied into its caller every call is a call, of the smallest function too.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function told(n) { report(n); report(n | 0); report(n + 0.5); report(n * 2); report(n > 2147483647); report(n === n); report(1 / n); report(typeof n); }
function toldFlag(flag) { report(flag); report(!flag); report(flag ? 1 : 2); report(flag === true); report(flag + 1); report(typeof flag); }
function half(n) { return n / 2; }
function sign(n) { if (n < 0) return -1; if (n > 0) return 1; return 0; }
function pick(flag, a, b) { return flag ? a : b; }
function isEven(n) { return n % 2 === 0; }
function bothEven(a, b) { return isEven(a) && isEven(b); }
function never() { return false; }
function bits(n) { return n | 0; }
function unsigned(n) { return n >>> 0; }
function negated(n) { return -n; }
function ratio(a, b) { return a / b; }
function sumTo(n) { let sum = 0; for (let i = 1; i <= n; i++) { sum += i; } return sum; }
function largest(list, n) { let best = list[0]; for (let i = 1; i < n; i++) { if (list[i] > best) best = list[i]; } return best; }
function nested(n) { return half(sign(n) + bits(n)) + unsigned(n); }
function total(list, n) { let sum = 0; for (let i = 0; i < n; i++) { sum = sum + list[i]; } return sum; }
function apply(f, n) { return f(n); }
function third(n) { return n / 3; }
function low(n) { return n & 255; }
function opposite(n) { return -n; }
told(half(7));
told(half(8));
told(sign(-3));
told(sign(0));
told(sign(0.25));
told(pick(true, 1, 2.5));
told(pick(false, 1, 2.5));
toldFlag(isEven(4));
toldFlag(isEven(5));
toldFlag(isEven(0.5));
toldFlag(bothEven(2, 4));
toldFlag(bothEven(2, 3));
toldFlag(never());
told(bits(7.9));
told(bits(4294967297));
told(bits(-2147483649));
told(unsigned(-1));
told(unsigned(5));
told(negated(0));
told(negated(5));
told(negated(-2147483648));
told(ratio(1, 0));
told(ratio(-1, 0));
told(ratio(0, 0));
told(ratio(1, 3));
told(sumTo(10));
told(sumTo(100000));
told(largest([3, 9.5, 4], 3));
told(largest([3, 9, 4], 3));
told(nested(-7));
told(nested(9));
told(total([1, 2, 3], 3));
told(total([1.5, 2, 2147483647], 3));
told(total([], 0));
told(apply(third, 7));
told(apply(low, 775.5));
told(apply(opposite, 0));
report(half(3) + half(5) * sign(-2));
report(isEven(sumTo(3)) ? half(1) : bits(9.5));
report("end");
