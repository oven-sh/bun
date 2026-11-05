export const heldTooMuchTogether = "KILLED: the commands that ran at once held too much together";

export function describeKill(held: string, cmd: string[]) {
  const why = held.includes("; the machine had ") ? "KILLED: the machine had too little left" : heldTooMuchTogether;
  return `${why}: ${held}. Run fewer of them at once: ${cmd.join(" ")}`;
}
