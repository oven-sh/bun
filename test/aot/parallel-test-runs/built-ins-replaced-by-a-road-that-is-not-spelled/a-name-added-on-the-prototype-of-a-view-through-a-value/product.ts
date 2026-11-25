export function work(): string {
  const view = new Uint8Array([3, 1, 2, 7]);
  let out = "";
  for (let turn = 0; turn < 3; turn++) out += String((view.set([turn, 5]), view[1])) + ",";
  return out;
}
