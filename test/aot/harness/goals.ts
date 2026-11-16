/**
 * A case that is declared with `failing` prints nothing where it fails as expected, and the number in its name is that of the day on which it was written. Said in front of
 * the expectation, this line tells what the case counts today, so that whoever compares two runs sees a count that moves away from its bound:
 *
 *   GOAL <name>: <counted> for <bound>
 *
 * The name is that of the case without its numbers.
 */
export function sayGoal(name: string, counted: number, bound: number) {
  console.log(`GOAL ${name}: ${counted} for ${bound}`);
}
