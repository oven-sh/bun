// macro code:
export function mysteryBox(node) {
  const dice = Math.round(Math.random() * 100);
  if (dice < 25) {
    return <number value={5} />;
  } else if (dice < 50) {
    return <true />;
  } else if (dice < 75) {
    return <false />;
  } else if (dice < 90) {
    return <string value="a string" />;
  } else {
    return <string value={"a very rare string " + dice.toString(10)} />;
  }
}
