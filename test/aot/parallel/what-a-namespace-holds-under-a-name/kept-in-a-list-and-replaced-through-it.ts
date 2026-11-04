namespace N {
  export function f(): number { return 1; }
  export function g(): number { return f() + 1; }
  export let level = 5;
  export const list = [1, 2];
}
function once(): unknown { try { return N.f(); } catch (e) { return (e as Error).constructor.name; } }
function often(): unknown { let s = 0; try { for (let i = 0; i < 3; i++) s += N.f() * 10 + N.g() + N.level; } catch (e) { return (e as Error).constructor.name; } return s; }
function show(): void { console.log(once(), often(), N.g(), typeof N.level, N.level, N.list.length, Object.keys(N).join()); }
const few = process.argv.length < 100;
show();
const kept: any[] = [N]; if (few) kept[0].f = () => 4;
show();
