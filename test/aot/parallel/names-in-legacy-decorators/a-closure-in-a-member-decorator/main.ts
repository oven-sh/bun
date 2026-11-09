const thunks: Array<() => any> = [];
function link(thunk: () => any) {
  return (_target: any, _key: string) => { thunks.push(thunk); };
}
function linkParameter(thunk: () => any) {
  return (_target: any, _key: any, _index: number) => { thunks.push(thunk); };
}
function swap(_original: any): any {
  return class Replacement { static tag = "replacement"; };
}
@swap
class Branch {
  static tag = "original";
  @link(() => Branch) parent: any;
  grow(@linkParameter(() => Branch) by: number) { return by; }
}
console.log(thunks.map((thunk) => thunk().tag).join(" "), (Branch as any).tag);
