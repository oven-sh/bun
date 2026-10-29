namespace Aliased {
  declare const a: number;
}
import Other = Aliased;
export const kind = typeof Other;
