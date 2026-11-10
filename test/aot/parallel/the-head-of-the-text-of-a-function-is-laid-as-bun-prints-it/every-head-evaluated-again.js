const functions = [
  function /* a */ named /* b */ ( /* c */ a /* d */ , /* e */ b /* f */ ) /* g */ { return [a, b]; },
  function // a
  named // b
  ( // c
    a // d
    , // e
    b // f
  ) // g
  { return [a, b]; },
  function
  (a,
   b)
  { return [a, b]; },
  function /* a */ * /* b */ made /* c */ (a, b) { yield [a, b]; },
  function
  *
  made
  (a, b) { yield [a, b]; },
  function*(a, b) { yield [a, b]; },
  async /* a */ function /* b */ (a, b) { return [a, b]; },
  async function /* a */ * /* b */ (a, b) { yield [a, b]; },
  a => [a], a=>[a], a /* a */ => /* b */ [a], a => // a
    [a], a =>
    [a], a =>
    ({ a }), a => /* a */ ({ a }), a =>
    /1/.test(a), a => /1/.test(a), a =>
    `${a}`, a =>
    (a, 2), a =>
    +a, a =>
    -a, a =>
    ++a, a =>
    !a, a =>
    function () { return a; }(), a =>
    b => [a, b], a => { return [a]; }, a =>
    { return [a]; },
  async a => [a], async /* a */ a /* b */ => [a], async (a) => [a], async /* a */ ( /* b */ a /* c */ ) /* d */ => [a], async(a)=>[a], async (
    a
  ) => [a],
  (a /* a */ = /* b */ 3 /* c */, b = 4 // d
  ) => [a, b], (a = (3, 5), b = c => c) => [a, b(6)], (a = "//", b = "/*") => [a, b], (a = /\//, b = /[/*]/) => [String(a), String(b)], (a = `)`, b = ")") => [a, b],
  ({ a /* a */ = /* b */ 3 /* c */ , /* d */ b /* e */ : /* f */ c /* g */ } /* h */ = /* i */ {}) => [a, c], ([ /* a */ a /* b */ , /* c */ , /* d */ b /* e */ ] = [1, 2, 3]) => [a, b],
  ( /* a */ ... /* b */ rest /* c */ ) => rest, (a, ... [ b , c ]) => [a, b, c], ({ a , ... rest }) => [a, rest],
  function one(\u{61}, b) { return [a, b]; }, function (\u0061,b){ return [a, b]; }, function \u{6f}ne ( a ){ return [a, typeof one]; },
  \u{61} => [a], (\u{61},b)=>[a, b], async \u0061 => [a], ({ \u{61} , b })=>[a, b], ({ k : \u{61} }={ k: 3 })=>[a], (\u{1d4d0})=>[\u{1d4d0}],
  async => [async], (async) => [async], of => [of], get => [get], (set, get) => [set, get], yield_ => [yield_],
];
const holder = {
  plain /* a */ ( /* b */ a /* c */ ) /* d */ { return [a]; },
  async /* a */ later /* b */ (a) { return [a]; },
  * /* a */ made /* b */ (a) { yield [a]; },
  async /* a */ * /* b */ madeLater /* c */ (a) { yield [a]; },
  get /* a */ read /* b */ ( /* c */ ) /* d */ { return [1]; },
  set /* a */ written /* b */ ( /* c */ a /* d */ ) /* e */ { this.kept = [a]; },
  get
  overLines
  ()
  { return [2]; },
  get(a) { return ["get", a]; }, set(a) { return ["set", a]; }, async(a) { return ["async", a]; }, static(a) { return ["static", a]; },
  "a name" /* a */ (a) { return [a]; }, 12 /* a */ (a) { return [a]; },
  esc\u{61}ped ( a ){ return [a]; }, "quoted\u{61}" ( a ){ return [a]; }, get  r\u0065ad2 (){ return [3]; },
};
const said = async call => {
  try {
    let value = await call();
    if (value && typeof value.next === "function") value = (await value.next()).value;
    return JSON.stringify(value) ?? "undefined";
  } catch (error) {
    return error.name;
  }
};
for (const written of functions) {
  const again = new Function("return (" + String(written) + ")")();
  console.log(await said(() => written(1, 2)), await said(() => again(1, 2)));
  console.log(await said(() => written()), await said(() => again()));
}
for (const name of Object.keys(holder)) {
  const { get, set, value } = Object.getOwnPropertyDescriptor(holder, name);
  const again = new Function("return ({" + String(get ?? set ?? value) + "})")();
  if (set) { holder[name] = 1; again[name] = 1; console.log(name, JSON.stringify(holder.kept), JSON.stringify(again.kept)); }
  else if (get) console.log(name, JSON.stringify(holder[name]), JSON.stringify(again[name]));
  else console.log(name, await said(() => holder[name](1)), await said(() => again[name](1)));
}
