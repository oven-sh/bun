const forms = [
  ({a})=>a, ({ a })=>a, ({a,})=>a, ({a,b})=>a, ({a:b})=>b, ({a : b})=>b, ({a:{b}})=>b, ({a=1})=>a, ({a:b=1})=>b, ({"x y":z})=>z, ({1:z})=>z, ({...r})=>r, ({a,...r})=>a,
  ({})=>1, ({ })=>1, ([])=>1, ([ ])=>1, ([a])=>a, ([a,])=>a, ([a,b])=>a, ([,a])=>a, ([a,...r])=>a, ([a=1])=>a, ([{a}])=>a, ({a:[b]})=>b, ({a},{b})=>a, ({a}={})=>a, ([a]=[])=>a,
  ({ a /* the first */ }) => a, ({ a, /* the second */ b }) => a, ({ a: /* renamed */ b }) => b, ({ ["k"]: z }) => z,
];
const overLines = [
  ({
    a, // the first
    b,
  }) => a, ({ a,
    b }) => a, (
    { a }
  ) => a, ({ a: {
    b } }) => b, ([
    a, b ]) => a, function ({
    a,
    b = 2,
  }, [
    c,
  ]) {},
];
for (const form of forms) console.log(JSON.stringify(String(form)));
for (const form of overLines) console.log(JSON.stringify(String(form).replace(/\s+/g, "")));
