export class UserC { id: number = 0; name: string = "made"; }
export function one(u: UserC): string { return u.name + u.id + " " + (u instanceof UserC); }
export default function byDefault(u: UserC): string { return one(u); }
export class Taker { kept: UserC; constructor(u: UserC) { this.kept = u; } show(): string { return one(this.kept); } }
export function own(): string { return one(new UserC()); }
