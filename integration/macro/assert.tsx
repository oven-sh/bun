// This logs the result at build time
export function unreachable(call) {
  throw new Error(call.arguments[0].toString() || "unreachable");
}
