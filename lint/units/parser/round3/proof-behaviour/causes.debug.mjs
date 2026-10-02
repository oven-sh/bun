// The one difference between a debug and a release binary of the same tree: Lexer::expect_contextual_keyword names the token.
const strip = v => (v[0] === "e" ? ["e", v[1].map(([message, ...rest]) => [message.replace(/ \(token: T[A-Za-z]+\)$/, ""), ...rest])] : v);
export default [
  {
    id: "debug-token-suffix",
    title: "a debug build ends the message of expect_contextual_keyword with (token: T...)",
    match: d => d.cls === "R>R" && JSON.stringify(strip(d.next)) === JSON.stringify(d.base),
  },
];
