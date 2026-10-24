function describe(error) {
  if (error instanceof SuppressedError)
    return `SuppressedError(${error.message}; error: ${describe(error.error)}; suppressed: ${describe(error.suppressed)})`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function attempt(label, body) {
  try {
    console.log(label, "returned", body());
  } catch (error) {
    console.log(label, "threw", describe(error));
  }
}

const order = [];
const resource = name => ({
  [Symbol.dispose]() {
    order.push(name);
  },
});
const failing = name => ({
  [Symbol.dispose]() {
    order.push(name);
    throw new RangeError(name);
  },
});
function flushOrder() {
  console.log(order.join(" "));
  order.length = 0;
}

attempt("number", () => {
  using x = 5;
  return "unreachable";
});
attempt("string", () => {
  using x = "text";
  return "unreachable";
});
attempt("no method", () => {
  using x = {};
  return "unreachable";
});
attempt("method is a number", () => {
  using x = { [Symbol.dispose]: 5 };
  return "unreachable";
});
attempt("method is null", () => {
  using x = { [Symbol.dispose]: null };
  return "unreachable";
});
attempt("null and undefined", () => {
  using x = null;
  using y = undefined;
  return "nothing to dispose";
});

attempt("second declaration is invalid", () => {
  using a = resource("a");
  using b = 5;
  return "unreachable";
});
flushOrder();

attempt("body throws undefined", () => {
  using a = failing("a");
  throw undefined;
});
flushOrder();

attempt("body throws undefined, nothing fails", () => {
  using a = resource("a");
  throw undefined;
});
flushOrder();

attempt("three failures", () => {
  using a = failing("a");
  using b = failing("b");
  using c = failing("c");
  return "unreachable";
});
flushOrder();

attempt("body and three failures", () => {
  using a = failing("a");
  using b = failing("b");
  using c = failing("c");
  throw new EvalError("body");
});
flushOrder();

attempt("nine resources, some fail", () => {
  using a = resource("a");
  using b = failing("b");
  using c = resource("c");
  using d = resource("d");
  using e = failing("e");
  using f = resource("f");
  using g = resource("g");
  using h = failing("h");
  using i = resource("i");
  return "unreachable";
});
flushOrder();

attempt("nine resources, body throws", () => {
  using a = resource("a");
  using b = resource("b");
  using c = resource("c");
  using d = resource("d");
  using e = failing("e");
  using f = resource("f");
  using g = resource("g");
  using h = resource("h");
  using i = resource("i");
  throw new EvalError("body");
});
flushOrder();

for (let index = 0; index < 3; index++) {
  attempt(`loop ${index}`, () => {
    using a = index === 1 ? failing(`a${index}`) : resource(`a${index}`);
    using b = failing(`b${index}`);
    return "unreachable";
  });
}
flushOrder();

attempt("resources in a for-of head", () => {
  for (using item of [resource("x"), failing("y"), resource("z")]) order.push("body");
  return "unreachable";
});
flushOrder();

attempt("disposal without errors", () => {
  using a = resource("a");
  using b = resource("b");
  using c = resource("c");
  using d = resource("d");
  using e = resource("e");
  using f = resource("f");
  return "finished";
});
flushOrder();
