export function codes(text: string, atTurn: number, then: () => void): string {
  let sum = "";
  for (let at = 0; at < text.length; at++) {
    if (at === atTurn) then();
    sum += text.charCodeAt(at) + ",";
  }
  return sum;
}
