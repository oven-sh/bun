const thunks: Array<() => any> = [];
function link(thunk: () => any) { return (_t: any, _k: string) => { thunks.push(thunk); }; }
function swap(_original: any): any { return class Replacement { static tag = "replacement"; }; }
export @swap class Branch { static tag = "original"; @link(() => Branch) parent: any; }
@swap export default class Other { static tag = "original"; @link(() => Other) parent: any; }
console.log(thunks.map((t) => t().tag).join(" "));
