export function work(): string {
  const text: string = JSON.parse('"abc"');
  let out = "";
  for (let turn = 0; turn < 3; turn++) out += String(text.hasOwnProperty("length")) + ",";
  return out;
}
