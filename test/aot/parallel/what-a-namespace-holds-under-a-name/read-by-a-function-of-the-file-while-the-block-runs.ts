function look(): string { try { return typeof N.late + " " + typeof N.first + " " + Object.keys(N).join(); } catch (e) { return (e as Error).constructor.name; } }
console.log(look());
namespace N {
  export const first = look();
  export function late(): number { return 1; }
  export const second = look();
}
console.log(N.first); console.log(N.second); console.log(look());
