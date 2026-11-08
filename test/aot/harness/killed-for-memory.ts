export const heldTooMuchTogether = "KILLED: the commands that ran at once held too much together";

export function describeKill(held: string, cmd: string[]) {
  return `${heldTooMuchTogether}: ${held}. Run fewer of them at once: ${cmd.join(" ")}`;
}
