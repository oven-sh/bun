export const Kind = { User: "user", Tool: "tool", Count: 2, Enabled: true, Nothing: null } as const;
export const Made = { first: make(1), second: make(2), literal: 3 };
function make(n: number) {
  return { n };
}
export function kindOf(x: string) {
  return x === Kind.User ? "a user" : x === Kind.Tool ? "a tool" : "neither";
}
export function secondMade() {
  return Made.second.n + Made.literal;
}
