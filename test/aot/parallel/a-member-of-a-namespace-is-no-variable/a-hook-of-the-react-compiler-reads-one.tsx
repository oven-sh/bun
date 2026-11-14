// Flags: --react-compiler
// The parser reads a member that a namespace exports off the closure parameter of its block, and an executable has no name for that parameter. A hook that reads one stays as it is written.
namespace Sizes {
  export const base = Number("16");
  export function useRow(first: number) {
    "use memo";
    return [first, first + 1].map(n => base + n).join(",");
  }
}
namespace Sizes {
  export function useCell(first: number) {
    "use memo";
    return [first].map(n => base * 2 + n).join(",");
  }
}
// The parameter of a namespace that has a member of its own name has another name.
namespace Wide {
  export const Wide = Number("40");
  export function useBar(first: number) {
    "use memo";
    return [first, first + 1].map(n => Wide + n).join(",");
  }
}
console.log(Sizes.useRow(1), Sizes.useCell(1), Wide.useBar(1));
