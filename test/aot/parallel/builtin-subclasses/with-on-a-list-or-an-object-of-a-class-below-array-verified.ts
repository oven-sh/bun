// Flags: --aot-check=verify-each-stage
// Tests in front of with() prove an array with untouched storage, and the receiver is expected to be an object of the class. The call keeps the overload that the tests prove.
class Sub extends Array<any> {}
function withGetter() {
  const list: any = [1, 2];
  Object.defineProperty(list, 0, { get() { list.length = 1; return 8; } });
  return list;
}
function copy0(turn: number) {
  let list: any = turn % 11 === 10 ? [] : new Sub(1, 2, 3);
  const hold = list;
  const copy: any = (list as any).with(0, 9);
  copy[0] = 100;
  return [String(JSON.stringify(list))].join(" ");
}
{
  let hash = 0;
  let last = "";
  for (let turn = 0; turn < 6; turn++) {
    try {
      last = copy0(turn);
    } catch (error) {
      last = "threw " + (error as Error).name;
    }
    for (let at = 0; at < last.length; at++) hash = (hash * 31 + last.charCodeAt(at)) | 0;
  }
  console.log("scene 0", hash, last);
}
export {};
