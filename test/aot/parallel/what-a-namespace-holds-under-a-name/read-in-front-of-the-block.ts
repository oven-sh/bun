function early(): unknown { try { return N.f(); } catch (e) { return (e as Error).constructor.name; } }
console.log(early());
namespace N { export function f(): number { return 1; } }
console.log(early());
