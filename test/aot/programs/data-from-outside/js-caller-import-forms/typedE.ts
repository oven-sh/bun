export class UserE { id: number = 0; name: string = "made"; }
export function one(u: UserE): string { return u.name + u.id + " " + (u instanceof UserE); }
export default function byDefault(u: UserE): string { return one(u); }
export class Taker { kept: UserE; constructor(u: UserE) { this.kept = u; } show(): string { return one(this.kept); } }
export function own(): string { return one(new UserE()); }
