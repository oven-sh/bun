export class Ex { m() { return "Ex"; } static s = "Ex.s"; }
export function fn() { return "fn"; }
export default class Def { m() { return "Def"; } }
export let live = 1;
class Other { m() { return "Other"; } static s = "Other.s"; }
export function swap() {
    // @ts-ignore
    Ex = Other;
    // @ts-ignore
    fn = () => "fn2";
    // @ts-ignore
    Def = Other;
    live = 2;
}
export function inside() { return [new Ex().m(), Ex.s, fn(), new Def().m(), live].join(); }
