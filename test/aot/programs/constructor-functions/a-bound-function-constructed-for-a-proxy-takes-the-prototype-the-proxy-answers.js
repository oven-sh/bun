function ForProxyOfBound(a) {
  this.x = a;
  this.y = "y";
}
{
  const made = Reflect.construct(ForProxyOfBound.bind(null), [5], new Proxy(Object.bind(null), {}));
  console.log(
    "for a proxy of a bound function",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof ForProxyOfBound,
  );
}

function ForProxyOfObject(a) {
  this.x = a;
  this.y = "y";
}
{
  const made = Reflect.construct(ForProxyOfObject.bind(null), [6], new Proxy(Object, {}));
  console.log(
    "for a proxy of Object",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof ForProxyOfObject,
  );
}

function ForProxyOfItself(a) {
  this.x = a;
  this.y = "y";
}
{
  const made = Reflect.construct(ForProxyOfItself.bind(null), [7], new Proxy(ForProxyOfItself, {}));
  console.log(
    "for a proxy of itself",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof ForProxyOfItself,
  );
}

function ForProxyThatAnswers(a) {
  this.x = a;
  this.y = "y";
}
const answered = { answered: true };
const madeForAnswer = Reflect.construct(
  ForProxyThatAnswers.bind(null),
  [8],
  new Proxy(ForProxyThatAnswers, { get: (target, key) => (key === "prototype" ? answered : target[key]) }),
);
{
  const made = madeForAnswer;
  console.log(
    "for a proxy that answers another prototype",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof ForProxyThatAnswers,
  );
}
console.log(Object.getPrototypeOf(madeForAnswer) === answered, madeForAnswer.answered);

function BehindProxy(a) {
  this.x = a;
  this.y = "y";
}
{
  const made = Reflect.construct(new Proxy(BehindProxy.bind(null), {}), [9], Object.bind(null));
  console.log(
    "a proxy of a bound function",
    Object.keys(made).join(),
    JSON.stringify(made),
    JSON.stringify({ ...made }),
    JSON.stringify(Object.assign({}, made)),
    JSON.stringify(Object.entries(made)),
    Reflect.ownKeys(made).join(),
    Object.hasOwn(made, "x"),
    made.x,
    made.y,
    made instanceof BehindProxy,
  );
}
