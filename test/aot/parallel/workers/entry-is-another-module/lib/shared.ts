let count = 0;
export function bump(): number {
  return ++count;
}
export class Shared {
  static made = 0;
  constructor(public owner: string) {
    Shared.made++;
  }
}
export function describe(shared: Shared): string {
  return `${shared.owner} count=${count} made=${Shared.made}`;
}
